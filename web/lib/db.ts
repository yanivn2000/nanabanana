import { Pool } from "pg";
import * as Sentry from "@sentry/nextjs";
import { resolvePlaces, type MatchAttraction } from "./match";

// Postgres (Supabase) connection. Reads DATABASE_URL from the environment.
// A single pool is reused across hot-reloads / serverless invocations.
const g = globalThis as unknown as { _nbPool?: Pool };

function pool(): Pool | null {
  if (!process.env.DATABASE_URL) return null; // graceful: app still builds/runs
  if (!g._nbPool) {
    g._nbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Supabase pooler uses TLS
      // max stays >1 so a page's parallel Promise.all queries don't serialize.
      // The real capacity fix is the pooler PORT: use 6543 (transaction mode) in
      // production — connections return after each query, so many serverless
      // instances share them. Port 5432 (session mode) holds a connection for the
      // whole client and exhausts Supabase's 15-client cap. See .env.example.
      max: 4,
      idleTimeoutMillis: 10_000,      // release idle conns fast (don't hog the pool)
      connectionTimeoutMillis: 10_000, // fail fast instead of hanging when saturated
    });
  }
  return g._nbPool;
}

async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const p = pool();
  if (!p) return [];
  const res = await p.query(text, params);
  return res.rows as T[];
}

// --- Abuse protection (P1) ---------------------------------------------------
// Fixed-window rate limiter backed by Postgres (works across serverless
// instances, unlike in-memory). One atomic round-trip per check. Fails OPEN if
// the DB is unreachable — we never want the limiter to take the site down.
export async function checkRateLimit(
  bucket: string, limit: number, windowSec: number
): Promise<{ ok: boolean; count: number }> {
  try {
    // $2 = window seconds (limit is compared in JS, so it isn't a bind param —
    // an unused bind param makes Postgres fail to infer its type).
    const rows = await query<{ count: number }>(
      `INSERT INTO rate_limits (bucket, count, window_start)
         VALUES ($1, 1, now())
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start < now() - ($2::int * interval '1 second')
                      THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start < now() - ($2::int * interval '1 second')
                             THEN now() ELSE rate_limits.window_start END
       RETURNING count`,
      [bucket, windowSec]);
    const count = rows[0]?.count ?? 1;
    return { ok: count <= limit, count };
  } catch (e) {
    // fail OPEN, but surface it — a persistent failure here means the limiter
    // is silently off (and usually signals a DB problem worth alerting on).
    Sentry.captureException(e);
    return { ok: true, count: 0 };
  }
}

export type Attraction = {
  id: number;
  name_he: string | null;
  name_en: string;
  lat: number | null;
  lng: number | null;
  category: string;
  subcategory: string | null;
  indoor_outdoor: string | null;
  family_score: number | null;
  tips_he: string | null;
  website: string | null;
  duration_minutes: number | null;
  image_url: string | null;
  tagline_he: string | null;
  best_season: string | null;
  best_time_he: string | null;
  dress_he: string | null;
  cost_level: number | null;
  must_see: number | null;      // EFFECTIVE: editor rank='must' (curated) else OSM
  osm_must_see: number | null;  // the raw OSM flag, kept as an editor reference
  editor_rank: string | null;   // editor importance: 'must' | 'maybe' | 'no' | null
  editor_kids: string | null;   // editor kids fit: 'yes' | 'maybe' | 'no' | null
  description_he: string | null;
  taste_tags: string[] | null;
  audience_fit: AudienceFit | null;  // {families,couples,friends} 0-100 + type — the short-path signal
  admin_bonus: AudienceBonus | null; // editor's manual per-audience points, added to consensus
  notable: boolean;                  // has a Wikipedia/Wikidata entry (worthiness input)
};

// Per-attraction audience suitability, computed by the consensus pipeline.
export type AudienceFit = { families: number; couples: number; friends: number; type: string; why_he?: string };
// Editor's manual boost per audience (points added to the computed consensus).
export type AudienceBonus = { families?: number; couples?: number; friends?: number };

const ATTR_COLS = `id, name_he, name_en, lat, lng, category, subcategory,
  indoor_outdoor, family_score, tips_he, website, duration_minutes,
  image_url, tagline_he, best_season, best_time_he, dress_he, cost_level, must_see,
  description_he, taste_tags, audience_fit, admin_bonus`;

export type Destination = {
  id: number;
  city: string;
  country: string;
  city_he: string | null;
  country_he: string | null;
  lat: number;
  lng: number;
  mobility: string;
  attraction_count: number;
};

// A row is "shown" in the consumer app: kept-or-unassessed, not a dup/component.
const SHOWN = `(a.quality_keep = 1 OR a.quality_keep IS NULL)
  AND (a.is_duplicate IS NULL OR a.is_duplicate = 0)
  AND (a.is_component IS NULL OR a.is_component = 0)`;
// Notability signal: mapped in OSM with a Wikipedia/Wikidata entry.
const NOTABLE = `(info_sources IS NOT NULL AND info_sources::text NOT IN ('[]', 'null'))`;

const DEST_SELECT = `SELECT dest.id, dest.city, dest.country, dest.city_he,
         dest.country_he, dest.lat, dest.lng, dest.mobility,
         count(a.id) FILTER (WHERE ${SHOWN})::int AS attraction_count
  FROM destinations dest
  LEFT JOIN attractions a ON a.destination_id = dest.id`;

export async function listDestinations(): Promise<Destination[]> {
  return query<Destination>(
    `${DEST_SELECT} GROUP BY dest.id ORDER BY attraction_count DESC`
  );
}

export async function getDestination(id: number): Promise<Destination | null> {
  const rows = await query<Destination>(
    `${DEST_SELECT} WHERE dest.id = $1 GROUP BY dest.id`, [id]
  );
  return rows[0] ?? null;
}

// --- Editor overlay -------------------------------------------------------
// A pure PER-ATTRACTION overlay on the raw OSM flag: an attraction the editor
// ranked uses that rank (must → must-see, else not); an UN-ranked attraction
// keeps its OSM must_see. So clearing a rank reverts to the OSM default, and a
// demotion sticks only for that one place (no city-wide seeding needed).
const EDITOR_JOIN = `
  LEFT JOIN editor_picks ep ON ep.destination_id = a.destination_id AND ep.attraction_id = a.id`;
const EFF_MUST = `CASE WHEN ep.rank IS NOT NULL THEN (ep.rank = 'must')::int ELSE a.must_see END`;
// Importance tier for ORDER BY: editor 'no' floors it (0); effective must-see
// leads (4); editor 'maybe' is a mid boost (3); everything else normal (2).
const EDITOR_ORDER = `(CASE WHEN ep.rank = 'no' THEN 0
  WHEN COALESCE(${EFF_MUST}, 0) = 1 THEN 4
  WHEN ep.rank = 'maybe' THEN 3 ELSE 2 END) DESC`;
// ATTR_COLS with must_see swapped for the effective value + the editor columns
// (osm_must_see kept as the raw reference; editor_rank/editor_kids surfaced).
const ATTR_COLS_EFF = ATTR_COLS.replace(/\bmust_see\b/,
  `${EFF_MUST} AS must_see, a.must_see AS osm_must_see, ep.rank AS editor_rank, ep.kids AS editor_kids`)
  + `, ${NOTABLE} AS notable`;

export async function topAttractions(destinationId: number, limit = 40): Promise<Attraction[]> {
  // The builder's auto pool. Uses the editor's effective must-see and EXCLUDES
  // editor-rejected places (rank='no') so a demoted tourist trap never anchors.
  return query<Attraction>(
    `SELECT ${ATTR_COLS_EFF}
       FROM attractions a ${EDITOR_JOIN}
       WHERE a.destination_id = $1
         AND (a.quality_keep = 1 OR a.quality_keep IS NULL)
         AND (a.is_duplicate IS NULL OR a.is_duplicate = 0)
         AND (a.is_component IS NULL OR a.is_component = 0)
         AND (ep.rank IS NULL OR ep.rank <> 'no')
       ORDER BY ${EDITOR_ORDER},
                COALESCE(a.quality_keep = 1, false) DESC,
                ${NOTABLE} DESC,
                COALESCE(a.family_score, 0) DESC, a.name_en
       LIMIT $2`,
    [destinationId, limit]
  );
}

// Fetch specific attractions by id — the traveler's exact picks. Keeps
// editor-rejected ones (the user explicitly chose them; their choice wins), but
// still carries the effective must_see + editor ratings.
export async function attractionsByIds(ids: number[]): Promise<Attraction[]> {
  if (!ids.length) return [];
  return query<Attraction>(
    `SELECT ${ATTR_COLS_EFF} FROM attractions a ${EDITOR_JOIN} WHERE a.id = ANY($1)`, [ids]);
}

export async function attractionsForMap(destinationId: number, limit = 200): Promise<Attraction[]> {
  return query<Attraction>(
    `SELECT ${ATTR_COLS_EFF}
       FROM attractions a ${EDITOR_JOIN}
       WHERE a.destination_id = $1 AND a.lat IS NOT NULL AND a.lng IS NOT NULL
         AND (a.quality_keep = 1 OR a.quality_keep IS NULL)
         AND (a.is_duplicate IS NULL OR a.is_duplicate = 0)
         AND (a.is_component IS NULL OR a.is_component = 0)
       ORDER BY ${EDITOR_ORDER},
                COALESCE(a.quality_keep = 1, false) DESC,
                ${NOTABLE} DESC,
                COALESCE(a.family_score, 0) DESC, a.name_en
       LIMIT $2`,
    [destinationId, limit]
  );
}

// Editor curation: set one of an attraction's two 3-state ratings —
// `rank` (importance: must | maybe | no) or `kids` (fit: yes | maybe | no);
// null clears it (reverts that axis to the raw OSM / data default). A pure
// per-attraction overlay — no city-wide seeding.
export async function setEditorRating(
  destinationId: number, attractionId: number,
  field: "rank" | "kids", value: string | null, by: string
): Promise<void> {
  // Upsert the chosen field; keep the other axis intact.
  const col = field === "rank" ? "rank" : "kids";
  await query(
    `INSERT INTO editor_picks (destination_id, attraction_id, ${col}, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (destination_id, attraction_id) DO UPDATE SET ${col} = EXCLUDED.${col}`,
    [destinationId, attractionId, value, by]
  );
  // Tidy: drop rows that no longer carry any rating.
  await query(
    `DELETE FROM editor_picks WHERE destination_id = $1 AND attraction_id = $2 AND rank IS NULL AND kids IS NULL`,
    [destinationId, attractionId]
  );
}

// Per-destination "what it offers" summary — feeds the destination recommender.
export type DestinationSummary = {
  id: number; city: string; country: string;
  city_he: string | null; country_he: string | null;
  total: number; nature: number; museum: number; historic: number;
  food: number; shopping: number; water_park: number; theme_park: number;
  zoo: number; must_see: number;
};

export async function destinationSummaries(): Promise<DestinationSummary[]> {
  return query<DestinationSummary>(
    `SELECT d.id, d.city, d.country, d.city_he, d.country_he,
        count(a.id)::int AS total,
        count(*) FILTER (WHERE a.category='nature')::int   AS nature,
        count(*) FILTER (WHERE a.category='museum')::int   AS museum,
        count(*) FILTER (WHERE a.category='historic')::int AS historic,
        count(*) FILTER (WHERE a.category='food')::int     AS food,
        count(*) FILTER (WHERE a.category='shopping')::int AS shopping,
        count(*) FILTER (WHERE a.subcategory='water_park')::int AS water_park,
        count(*) FILTER (WHERE a.subcategory='theme_park')::int AS theme_park,
        count(*) FILTER (WHERE a.subcategory='zoo')::int        AS zoo,
        count(*) FILTER (WHERE a.must_see=1)::int          AS must_see
      FROM destinations d JOIN attractions a ON a.destination_id = d.id
      WHERE (a.quality_keep = 1 OR a.quality_keep IS NULL)
        AND (a.is_duplicate IS NULL OR a.is_duplicate = 0)
      GROUP BY d.id ORDER BY total DESC`
  );
}

// --- Verified-knowledge layer: real-traveller insights distilled + approved
// in the admin. Trusted ABOVE generic web knowledge, used with and without AI.
export type Insight = {
  id: number;
  attraction_id: number | null;
  place_name: string | null;
  kind: string;            // tip | warning | verdict | food | season | access
  text_he: string;
  sentiment: string | null; // pos | neg | neutral
};

// All approved insights for a destination (attraction-linked + general).
export async function insightsForDestination(destinationId: number): Promise<Insight[]> {
  return query<Insight>(
    `SELECT id, attraction_id, place_name, kind, text_he, sentiment
       FROM insights
       WHERE destination_id = $1 AND status = 'approved'
       ORDER BY weight DESC, id DESC`,
    [destinationId]
  );
}

// --- Admin: browse + prune the stored insights ------------------------------
export type AdminInsight = {
  id: number; place_name: string | null; attraction_id: number | null;
  attraction_name: string | null; kind: string; text_he: string;
  sentiment: string | null; status: string; created_at: string;
  author_profile: string | null;
};

// Per-city insight counts, for the admin "which cities have insights" list.
export async function adminInsightCounts(): Promise<{ destination_id: number; city: string; count: number }[]> {
  return query<{ destination_id: number; city: string; count: number }>(
    `SELECT i.destination_id, COALESCE(d.city_he, d.city) AS city, COUNT(*)::int AS count
       FROM insights i JOIN destinations d ON d.id = i.destination_id
      GROUP BY i.destination_id, d.city_he, d.city
      ORDER BY count DESC`);
}

// Every insight for one city (all statuses), with its linked attraction name.
export async function adminInsightsForCity(destId: number): Promise<AdminInsight[]> {
  return query<AdminInsight>(
    `SELECT i.id, i.place_name, i.attraction_id,
            COALESCE(a.name_he, a.name_en) AS attraction_name,
            i.kind, i.text_he, i.sentiment, i.status, i.created_at,
            s.author_profile
       FROM insights i
       LEFT JOIN attractions a ON a.id = i.attraction_id
       LEFT JOIN sources s ON s.id = i.source_id
      WHERE i.destination_id = $1
      ORDER BY i.weight DESC, i.id DESC`, [destId]);
}

export async function deleteInsight(id: number): Promise<boolean> {
  const rows = await query<{ id: number }>(`DELETE FROM insights WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

// --- Admin: full-transparency attraction table + manual per-audience bonus ---
export type AdminAttractionRow = {
  id: number; name_he: string | null; name_en: string; category: string;
  must_see: number | null; editor_rank: string | null; editor_kids: string | null;
  audience_fit: AudienceFit | null; admin_bonus: AudienceBonus | null;
  notable: boolean; family_score: number | null; traveler_count: number;
};

// Every shown attraction for a city with its scoring signals — the admin sees
// exactly what drives the consensus, and can add a manual per-audience bonus.
export async function adminAttractionsForCity(destinationId: number): Promise<AdminAttractionRow[]> {
  return query<AdminAttractionRow>(
    `SELECT a.id, a.name_he, a.name_en, a.category,
            ${EFF_MUST} AS must_see, ep.rank AS editor_rank, ep.kids AS editor_kids,
            a.audience_fit, a.admin_bonus, ${NOTABLE} AS notable, a.family_score,
            COALESCE((SELECT COUNT(DISTINCT source_id) FROM insights i
                       WHERE i.attraction_id = a.id AND i.destination_id = $1 AND i.status='approved'), 0)::int AS traveler_count
       FROM attractions a ${EDITOR_JOIN}
      WHERE a.destination_id = $1
        AND (a.quality_keep = 1 OR a.quality_keep IS NULL)
        AND (a.is_duplicate IS NULL OR a.is_duplicate = 0)
        AND (a.is_component IS NULL OR a.is_component = 0)
      ORDER BY (a.audience_fit IS NOT NULL) DESC,
               GREATEST(COALESCE((a.audience_fit->>'families')::int, 0),
                        COALESCE((a.audience_fit->>'couples')::int, 0),
                        COALESCE((a.audience_fit->>'friends')::int, 0)) DESC,
               COALESCE(a.family_score, 0) DESC, a.name_en`,
    [destinationId]);
}

export async function setAdminBonus(attractionId: number, bonus: AudienceBonus): Promise<void> {
  const clean: AudienceBonus = {};
  for (const k of ["families", "couples", "friends"] as const) {
    const v = Math.round(Number(bonus[k]));
    if (Number.isFinite(v) && v !== 0) clean[k] = Math.max(-100, Math.min(100, v));
  }
  const val = Object.keys(clean).length ? JSON.stringify(clean) : null;
  await query(`UPDATE attractions SET admin_bonus = $1::jsonb WHERE id = $2`, [val, attractionId]);
}

export type RematchChange = {
  place: string; oldId: number | null; oldName: string | null;
  newId: number | null; newName: string | null; count: number;
};

// Re-run the (fixed) matcher over one city's stored insights. Groups by
// place_name, re-resolves each to an attraction (or null), and reports every
// change; only writes when apply=true. This is how we repair pins matched by
// the old buggy matcher, and the editor's "re-match" control.
export async function rematchDestination(
  destinationId: number, apply: boolean
): Promise<{ total: number; distinct: number; changed: RematchChange[]; applied: boolean }> {
  const dest = await query<{ city: string; city_he: string | null }>(
    `SELECT city, city_he FROM destinations WHERE id = $1`, [destinationId]);
  const atts = await query<MatchAttraction>(
    `SELECT id, name_en, name_he FROM attractions WHERE destination_id = $1
        AND (is_duplicate IS NULL OR is_duplicate = 0)
        AND (is_component IS NULL OR is_component = 0)`, [destinationId]);
  const cityNames = [dest[0]?.city, dest[0]?.city_he].filter(Boolean) as string[];
  const nameById = new Map(atts.map((a) => [a.id, a.name_he ?? a.name_en]));

  const rows = await query<{ place_name: string; attraction_id: number | null; count: number }>(
    `SELECT place_name, attraction_id, COUNT(*)::int AS count FROM insights
      WHERE destination_id = $1 AND place_name IS NOT NULL AND length(place_name) >= 2
      GROUP BY place_name, attraction_id`, [destinationId]);

  // aggregate current attraction_id(s) + total count per distinct place
  const byPlace = new Map<string, { old: Set<number | null>; count: number }>();
  for (const r of rows) {
    const e = byPlace.get(r.place_name) ?? { old: new Set<number | null>(), count: 0 };
    e.old.add(r.attraction_id); e.count += r.count; byPlace.set(r.place_name, e);
  }
  const places = [...byPlace.keys()];
  const resolved = await resolvePlaces(places, cityNames, atts, await getModel());

  const changed: RematchChange[] = [];
  for (const [place, info] of byPlace) {
    const newId = resolved.get(place) ?? null;
    const olds = [...info.old];
    const allSame = olds.length === 1 && olds[0] === newId;
    if (allSame) continue;
    const oldId = olds.length === 1 ? olds[0] : null;
    changed.push({
      place, oldId, oldName: oldId ? (nameById.get(oldId) ?? null) : null,
      newId, newName: newId ? (nameById.get(newId) ?? null) : null, count: info.count,
    });
  }
  if (apply) {
    for (const [place] of byPlace) {
      await query(`UPDATE insights SET attraction_id = $1 WHERE destination_id = $2 AND place_name = $3`,
        [resolved.get(place) ?? null, destinationId, place]);
    }
  }
  changed.sort((a, b) => b.count - a.count);
  return { total: rows.reduce((s, r) => s + r.count, 0), distinct: places.length, changed, applied: apply };
}

// Group a destination's insights by attraction id (for card display / prompts).
export async function insightsByAttraction(
  destinationId: number
): Promise<Map<number, Insight[]>> {
  const rows = await insightsForDestination(destinationId);
  const m = new Map<number, Insight[]>();
  for (const r of rows) {
    if (r.attraction_id == null) continue;
    (m.get(r.attraction_id) ?? m.set(r.attraction_id, []).get(r.attraction_id)!).push(r);
  }
  return m;
}

// --- Admin: destination management ------------------------------------------
export type AdminDestination = {
  id: number; city: string; country: string; region: string | null;
  city_he: string | null; country_he: string | null;
  lat: number; lng: number; description_he: string | null;
  best_months: number[] | null; israeli_popularity_score: number | null;
  timezone: string | null; currency: string | null; language: string | null;
  mobility: string; ingest_radius_km: number;
  shown_count: number; must_count: number; editor_ranked: number; img_pct: number; he_pct: number;
  transit_synced_at: string | null; edge_count: number; transit_edge_count: number;
};

// Every destination with its full record + content-health stats for the admin.
export async function adminDestinations(): Promise<AdminDestination[]> {
  return query<AdminDestination>(
    `SELECT d.id, d.city, d.country, d.region, d.city_he, d.country_he, d.lat, d.lng,
            d.description_he, d.best_months, d.israeli_popularity_score,
            d.timezone, d.currency, d.language, d.mobility, d.ingest_radius_km, d.transit_synced_at,
            (SELECT count(*)::int FROM attraction_edges e WHERE e.destination_id = d.id) AS edge_count,
            (SELECT count(*)::int FROM attraction_edges e WHERE e.destination_id = d.id AND e.transit_mode IS NOT NULL) AS transit_edge_count,
            count(a.id) FILTER (WHERE ${SHOWN})::int AS shown_count,
            count(a.id) FILTER (WHERE ${SHOWN} AND a.must_see = 1)::int AS must_count,
            (SELECT count(*)::int FROM editor_picks ep WHERE ep.destination_id = d.id AND ep.rank IS NOT NULL) AS editor_ranked,
            COALESCE(round(100.0 * count(a.id) FILTER (WHERE ${SHOWN} AND a.image_url IS NOT NULL)
              / NULLIF(count(a.id) FILTER (WHERE ${SHOWN}), 0))::int, 0) AS img_pct,
            COALESCE(round(100.0 * count(a.id) FILTER (WHERE ${SHOWN} AND a.name_he IS NOT NULL)
              / NULLIF(count(a.id) FILTER (WHERE ${SHOWN}), 0))::int, 0) AS he_pct
       FROM destinations d
       LEFT JOIN attractions a ON a.destination_id = d.id
       GROUP BY d.id
       ORDER BY shown_count DESC`);
}

// Whitelisted editable destination fields (the admin cities tab).
const DEST_EDITABLE = new Set([
  "city", "country", "region", "city_he", "country_he", "lat", "lng",
  "description_he", "best_months", "israeli_popularity_score",
  "timezone", "currency", "language", "mobility", "ingest_radius_km",
]);

export async function updateDestination(id: number, fields: Record<string, unknown>): Promise<boolean> {
  const entries = Object.entries(fields).filter(([k]) => DEST_EDITABLE.has(k));
  if (!entries.length) return false;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const vals = entries.map(([k, v]) => (k === "best_months" && Array.isArray(v) ? JSON.stringify(v) : v));
  await query(`UPDATE destinations SET ${sets} WHERE id = $1`, [id, ...vals]);
  return true;
}

// --- Trip modules ("משבצות"): reusable editor-approved regional blocks --------
export type TripTemplate = {
  id: string; destination_id: number | null; region: string | null;
  title_he: string; audience: string | null; days: number;
  itinerary: Itinerary; source_urls: string[]; notes: string | null;
  approved: boolean; created_by: string | null; created_at: string;
  city?: string | null; city_he?: string | null; country?: string | null; // joined for display
};

export async function saveTripTemplate(t: {
  destination_id: number | null; region?: string | null; title_he: string;
  audience?: string | null; days: number; itinerary: Itinerary;
  source_urls?: string[]; notes?: string | null; approved?: boolean; created_by?: string | null;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO trip_templates
       (destination_id, region, title_he, audience, days, itinerary, source_urls, notes, approved, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [t.destination_id, t.region ?? null, t.title_he, t.audience ?? null, t.days,
     JSON.stringify(t.itinerary), t.source_urls ?? [], t.notes ?? null, t.approved ?? false, t.created_by ?? null]);
  return rows[0].id;
}

// Admin: all modules (with city name) newest-first. approvedOnly for the composer.
export async function listTripTemplates(approvedOnly = false): Promise<TripTemplate[]> {
  return query<TripTemplate>(
    `SELECT t.*, d.city, d.city_he, d.country FROM trip_templates t
       LEFT JOIN destinations d ON d.id = t.destination_id
     ${approvedOnly ? "WHERE t.approved = true" : ""}
     ORDER BY t.created_at DESC`);
}

export async function deleteTripTemplate(id: string): Promise<void> {
  await query(`DELETE FROM trip_templates WHERE id = $1`, [id]);
}

// --- Admin: insights ingest (the knowledge layer) ----------------------------
// Distilled traveller insights are saved per-author as `sources` rows, each
// insight matched to one of our attractions by the hybrid resolver (./match).

export type IngestItem = { place: string; kind: string; text_he: string; sentiment: string; author?: string; author_profile?: string };

// Traveller-type of the SOURCE (who wrote the post) — the seed of real, non-AI
// audience signal ("N couples recommended this"). Inferred at distill, confirmed
// by the editor at ingest. 'general' = can't tell.
export const SOURCE_PROFILES = new Set(["family", "couple", "friends", "solo", "general"]);

// Persist approved insights, grouped per author into `sources` rows. Places are
// matched to attractions via the hybrid resolver in ./match (fuzzy shortlist +
// LLM), which handles transliteration and rejects non-attractions.
export async function saveInsights(
  destinationId: number, url: string | null, defaultAuthor: string | null,
  rawText: string, items: IngestItem[]
): Promise<{ sources: number; saved: number; matched: number }> {
  const dest = await query<{ city: string; city_he: string | null }>(
    `SELECT city, city_he FROM destinations WHERE id = $1`, [destinationId]);
  const atts = await query<MatchAttraction>(
    `SELECT id, name_en, name_he FROM attractions WHERE destination_id = $1
        AND (is_duplicate IS NULL OR is_duplicate = 0)
        AND (is_component IS NULL OR is_component = 0)`, [destinationId]);
  const cityNames = [dest[0]?.city, dest[0]?.city_he].filter(Boolean) as string[];
  // one batched LLM resolution for all distinct places, up front
  const resolved = await resolvePlaces(
    items.map((it) => it.place || "").filter(Boolean), cityNames, atts, await getModel());

  const groups = new Map<string | null, IngestItem[]>();
  for (const it of items) {
    const author = (it.author || defaultAuthor || "").trim() || null;
    (groups.get(author) ?? groups.set(author, []).get(author)!).push(it);
  }
  let saved = 0, matched = 0, sources = 0;
  for (const [author, group] of groups) {
    // all items in a group share one author → one source → one profile
    const p = group[0]?.author_profile ?? "";
    const profile = SOURCE_PROFILES.has(p) ? p : null;
    const src = await query<{ id: number }>(
      `INSERT INTO sources (destination_id, url, author, raw_text, author_profile, created_at)
       VALUES ($1,$2,$3,$4,$5,now()) RETURNING id`, [destinationId, url, author, rawText, profile]);
    const sourceId = src[0].id;
    sources++;
    for (const it of group) {
      const aid = (it.place && resolved.get(it.place)) || null;
      const place = it.place || null;
      const dup = await query(
        `SELECT 1 FROM insights WHERE destination_id=$1 AND text_he=$2
           AND attraction_id IS NOT DISTINCT FROM $3
           AND place_name IS NOT DISTINCT FROM $4 LIMIT 1`,
        [destinationId, it.text_he, aid, place]);
      if (dup.length) continue;
      if (aid) matched++;
      await query(
        `INSERT INTO insights (source_id, destination_id, attraction_id, place_name,
                               kind, text_he, sentiment, status, weight, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',1,now())`,
        [sourceId, destinationId, aid, place, it.kind, it.text_he, it.sentiment]);
      saved++;
    }
  }
  return { sources, saved, matched };
}

// --- Shared trips (the community layer, phase 0+1) ---------------------------
// A published, read-only copy of a local trip with a public slug URL. Owned by
// an anonymous owner_token (returned at publish, kept in the publisher's
// localStorage) — no login needed to share or to manage your own share.
import type { Itinerary } from "./trip-types";

export type SharedTrip = {
  id: number; slug: string; title: string;
  city: string | null; city_he: string | null; country: string | null; country_he: string | null;
  destination_id: number | null; days: number | null; month: number | null;
  composition: string | null; pace: string | null;
  itinerary: Itinerary; views: number; likes: number; remix_of: string | null;
  created_at: string; updated_at: string;
};

export type TripComment = {
  id: number; day_index: number | null; author_name: string; body: string;
  helpful: boolean; created_at: string;
};

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function makeSlug(city: string | null | undefined): string {
  const base = (city ?? "trip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "trip";
  let rand = "";
  for (let i = 0; i < 5; i++) rand += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  return `${base}-${rand}`;
}

// Publish (or, with slug+token, update) a shared trip. Returns {slug, token}.
export async function publishSharedTrip(t: {
  title: string; city?: string | null; city_he?: string | null; country?: string | null;
  country_he?: string | null; destination_id?: number | null; days?: number | null;
  month?: number | null; composition?: string | null; pace?: string | null;
  itinerary: Itinerary; remix_of?: string | null;
  slug?: string | null; owner_token?: string | null;
}): Promise<{ slug: string; token: string } | null> {
  if (t.slug && t.owner_token) {
    const upd = await query<{ slug: string }>(
      `UPDATE shared_trips SET title=$3, itinerary=$4, days=$5, month=$6, composition=$7,
              pace=$8, updated_at=now()
        WHERE slug=$1 AND owner_token=$2 RETURNING slug`,
      [t.slug, t.owner_token, t.title, JSON.stringify(t.itinerary), t.days ?? null,
       t.month ?? null, t.composition ?? null, t.pace ?? null]);
    if (upd.length) return { slug: t.slug, token: t.owner_token };
    return null; // wrong token / gone
  }
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = makeSlug(t.city);
    try {
      await query(
        `INSERT INTO shared_trips (slug, owner_token, title, city, city_he, country, country_he,
             destination_id, days, month, composition, pace, itinerary, remix_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [slug, token, t.title, t.city ?? null, t.city_he ?? null, t.country ?? null,
         t.country_he ?? null, t.destination_id ?? null, t.days ?? null, t.month ?? null,
         t.composition ?? null, t.pace ?? null, JSON.stringify(t.itinerary), t.remix_of ?? null]);
      return { slug, token };
    } catch { /* slug collision — retry */ }
  }
  return null;
}

export async function getSharedTrip(slug: string): Promise<SharedTrip | null> {
  // hidden = taken down by a moderator → 404 for the public.
  const rows = await query<SharedTrip>(`SELECT * FROM shared_trips WHERE slug = $1 AND hidden = false`, [slug]);
  return rows[0] ?? null;
}

// A lightweight card for the per-city community gallery — stop count computed in
// SQL so we never ship full itineraries just to list them.
export type SharedTripCard = {
  slug: string; title: string; days: number | null; composition: string | null;
  likes: number; views: number; stops: number; created_at: string;
};

export async function listSharedTripsForDestination(
  destId: number, limit = 60
): Promise<SharedTripCard[]> {
  return query<SharedTripCard>(
    `SELECT slug, title, days, composition, likes, views, created_at,
            COALESCE((SELECT SUM(jsonb_array_length(d->'stops'))
                        FROM jsonb_array_elements(itinerary->'days') d), 0)::int AS stops
       FROM shared_trips
      WHERE destination_id = $1 AND hidden = false
      ORDER BY likes DESC, created_at DESC
      LIMIT $2`,
    [destId, limit]);
}

export async function countSharedTripsForDestination(destId: number): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM shared_trips WHERE destination_id = $1 AND hidden = false`, [destId]);
  return rows[0]?.n ?? 0;
}

// Public (non-hidden) shared trips for the sitemap — slug + last-modified only.
export async function listPublicSharedTripSlugs(): Promise<{ slug: string; updated_at: string }[]> {
  return query<{ slug: string; updated_at: string }>(
    `SELECT slug, updated_at FROM shared_trips WHERE hidden = false ORDER BY updated_at DESC LIMIT 5000`);
}

// --- Moderation (P4) ---------------------------------------------------------
// Anyone can flag a comment or a shared trip; a report just bumps a counter
// (idempotency isn't critical here — the counter is a triage signal, not a vote).
export async function reportComment(id: number): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `UPDATE trip_comments SET reported = reported + 1 WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function reportSharedTrip(slug: string): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `UPDATE shared_trips SET reported = reported + 1 WHERE slug = $1 RETURNING id`, [slug]);
  return rows.length > 0;
}

// Editor moderation: hide/unhide. Hidden content vanishes from all public reads.
export async function setCommentHidden(id: number, hidden: boolean): Promise<void> {
  await query(`UPDATE trip_comments SET hidden = $2 WHERE id = $1`, [id, hidden]);
}
export async function setSharedTripHidden(slug: string, hidden: boolean): Promise<void> {
  await query(`UPDATE shared_trips SET hidden = $2 WHERE slug = $1`, [slug, hidden]);
}

export type ModerationComment = {
  id: number; slug: string; trip_title: string; author_name: string; body: string;
  reported: number; hidden: boolean; created_at: string;
};
export type ModerationTrip = {
  slug: string; title: string; city_he: string | null; reported: number;
  hidden: boolean; likes: number; views: number; created_at: string;
};

// The moderation queue: reported or already-hidden items, worst first.
export async function listModerationQueue(): Promise<{
  comments: ModerationComment[]; trips: ModerationTrip[];
}> {
  const comments = await query<ModerationComment>(
    `SELECT c.id, s.slug, s.title AS trip_title, c.author_name, c.body,
            c.reported, c.hidden, c.created_at
       FROM trip_comments c JOIN shared_trips s ON s.id = c.shared_trip_id
      WHERE c.reported > 0 OR c.hidden = true
      ORDER BY c.hidden ASC, c.reported DESC, c.id DESC LIMIT 200`);
  const trips = await query<ModerationTrip>(
    `SELECT slug, title, city_he, reported, hidden, likes, views, created_at
       FROM shared_trips
      WHERE reported > 0 OR hidden = true
      ORDER BY hidden ASC, reported DESC, id DESC LIMIT 200`);
  return { comments, trips };
}

// Anonymous like toggle, deduped server-side by (slug, ip): a given client can
// only move the counter once per trip, so the localStorage dedup can't be
// bypassed to inflate likes. Returns the authoritative count (null if no trip).
export async function likeSharedTrip(
  slug: string, ip: string, on: boolean
): Promise<number | null> {
  const exists = await query<{ id: number }>(`SELECT 1 AS id FROM shared_trips WHERE slug = $1`, [slug]);
  if (!exists.length) return null;
  let changed = false;
  if (on) {
    const ins = await query<{ slug: string }>(
      `INSERT INTO trip_likes (slug, ip) VALUES ($1, $2)
         ON CONFLICT (slug, ip) DO NOTHING RETURNING slug`, [slug, ip]);
    changed = ins.length > 0;
  } else {
    const del = await query<{ slug: string }>(
      `DELETE FROM trip_likes WHERE slug = $1 AND ip = $2 RETURNING slug`, [slug, ip]);
    changed = del.length > 0;
  }
  if (changed) {
    const rows = await query<{ likes: number }>(
      `UPDATE shared_trips SET likes = GREATEST(0, likes + $2) WHERE slug = $1 RETURNING likes`,
      [slug, on ? 1 : -1]);
    return rows[0]?.likes ?? null;
  }
  const cur = await query<{ likes: number }>(`SELECT likes FROM shared_trips WHERE slug = $1`, [slug]);
  return cur[0]?.likes ?? null;
}

export async function bumpSharedTripViews(slug: string): Promise<void> {
  await query(`UPDATE shared_trips SET views = views + 1 WHERE slug = $1`, [slug]);
}

export async function unpublishSharedTrip(slug: string, token: string): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `DELETE FROM shared_trips WHERE slug = $1 AND owner_token = $2 RETURNING id`, [slug, token]);
  return rows.length > 0;
}

export async function getTripComments(sharedTripId: number): Promise<TripComment[]> {
  return query<TripComment>(
    `SELECT id, day_index, author_name, body, helpful, created_at
       FROM trip_comments WHERE shared_trip_id = $1 AND hidden = false
       ORDER BY helpful DESC, id ASC`, [sharedTripId]);
}

export async function addTripComment(
  slug: string, dayIndex: number | null, authorName: string, body: string
): Promise<TripComment | null> {
  const rows = await query<TripComment>(
    `INSERT INTO trip_comments (shared_trip_id, day_index, author_name, body)
     SELECT id, $2, $3, $4 FROM shared_trips WHERE slug = $1
     RETURNING id, day_index, author_name, body, helpful, created_at`,
    [slug, dayIndex, authorName, body]);
  return rows[0] ?? null;
}

// The trip owner (proven by owner_token) marks a comment as "עזר לי".
export async function setCommentHelpful(
  slug: string, token: string, commentId: number, on: boolean
): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `UPDATE trip_comments c SET helpful = $4
       FROM shared_trips s
      WHERE c.id = $3 AND c.shared_trip_id = s.id AND s.slug = $1 AND s.owner_token = $2
      RETURNING c.id`, [slug, token, commentId, on]);
  return rows.length > 0;
}

// --- User feedback ("מצאתם באג? יש רעיון?") ---------------------------------
export type Feedback = {
  id: number; created_at: string; kind: string | null;
  message: string; email: string | null; page: string | null;
};

export async function addFeedback(f: {
  kind: string; message: string; email: string | null;
  page: string | null; userAgent: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO feedback (kind, message, email, page, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [f.kind, f.message, f.email, f.page, f.userAgent]
  );
}

export async function listFeedback(limit = 200): Promise<Feedback[]> {
  return query<Feedback>(
    `SELECT id, created_at, kind, message, email, page
       FROM feedback ORDER BY id DESC LIMIT $1`, [limit]);
}

// Shared AI model setting (written by the Streamlit admin Settings tab).
export async function getModel(): Promise<string> {
  const fallback = process.env.NANABANANA_MODEL || "claude-opus-4-8";
  try {
    const rows = await query<{ value: string }>(
      "SELECT value FROM settings WHERE key='model'"
    );
    return rows[0]?.value || fallback;
  } catch {
    return fallback;
  }
}

export function dataReady(): boolean {
  return pool() !== null;
}

// --- Admin poster picks (city hero photos chosen in /admin/posters) ---
export type PosterPick = {
  dest_id: number; variant: string; source: string | null;
  photo_id: string | null; photographer: string | null;
  photographer_url: string | null; src_url: string | null;
  page_url: string | null; materialized: boolean;
};

export async function getPosterPicks(): Promise<PosterPick[]> {
  return query<PosterPick>(
    `SELECT dest_id, variant, source, photo_id, photographer, photographer_url,
            src_url, page_url, materialized
       FROM poster_picks`
  );
}

// The picked poster for one destination — serves the live /api/poster redirect,
// so a pick made in the admin is published immediately (no file step).
export async function getPosterPick(destId: number): Promise<{ src_url: string } | null> {
  const rows = await query<{ src_url: string }>(
    `SELECT src_url FROM poster_picks WHERE dest_id = $1 ORDER BY (variant='default') DESC LIMIT 1`,
    [destId]);
  return rows[0] ?? null;
}

export async function setPosterPick(p: {
  dest_id: number; variant?: string; source: string; photo_id: string;
  photographer: string; photographer_url: string; src_url: string;
  page_url: string; width: number; height: number;
}): Promise<void> {
  await query(
    `INSERT INTO poster_picks
       (dest_id, variant, source, photo_id, photographer, photographer_url,
        src_url, page_url, width, height, picked_at, materialized)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), false)
     ON CONFLICT (dest_id, variant) DO UPDATE SET
       source=EXCLUDED.source, photo_id=EXCLUDED.photo_id,
       photographer=EXCLUDED.photographer, photographer_url=EXCLUDED.photographer_url,
       src_url=EXCLUDED.src_url, page_url=EXCLUDED.page_url,
       width=EXCLUDED.width, height=EXCLUDED.height,
       picked_at=now(), materialized=false`,
    [p.dest_id, p.variant ?? "default", p.source, p.photo_id, p.photographer,
     p.photographer_url, p.src_url, p.page_url, p.width, p.height]
  );
}

// --- Transport edge graph ("how to get from A to B") -------------------------
// Precomputed legs between attractions, so a planned itinerary shows mode + time
// without recomputing or hitting a paid routing API. The graph fills in from real
// builds: every trip records the walking bridges between its consecutive stops,
// keyed on attraction ids, and reused forever. Walk is deterministic; transit is
// layered on later from open GTFS (leaving these walk fields intact).
export type WalkLeg = { from: number; to: number; walk_m: number; walk_min: number };

export async function recordWalkEdges(destId: number, legs: WalkLeg[]): Promise<void> {
  const valid = legs.filter((l) => l.from && l.to && l.from !== l.to
    && Number.isFinite(l.walk_m) && Number.isFinite(l.walk_min));
  if (!valid.length) return;
  // One multi-row upsert. Refresh the walk estimate + timestamp on conflict, but
  // never touch transit_* here (a real GTFS lookup must not be clobbered by null).
  const rows: string[] = [];
  const params: unknown[] = [destId];
  for (const l of valid) {
    const b = params.length;
    rows.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, 'haversine', now())`);
    params.push(l.from, l.to, Math.round(l.walk_m), Math.round(l.walk_min));
  }
  await query(
    `INSERT INTO attraction_edges
       (destination_id, from_id, to_id, walk_m, walk_min, source, computed_at)
     VALUES ${rows.join(", ")}
     ON CONFLICT (from_id, to_id) DO UPDATE SET
       walk_m = EXCLUDED.walk_m, walk_min = EXCLUDED.walk_min,
       destination_id = EXCLUDED.destination_id, computed_at = now()`,
    params
  );
}

// Read cached edges for a set of ordered pairs (both directions accepted, since
// walking is symmetric). Returned keyed as "from-to" for whichever direction hit.
export type AttractionEdge = {
  from_id: number; to_id: number; walk_m: number | null; walk_min: number | null;
  transit_mode: string | null; transit_line: string | null;
  transit_min: number | null; transit_transfers: number | null;
  source: string; transit_checked_at: string | null;
};

export async function getEdges(ids: number[]): Promise<AttractionEdge[]> {
  const clean = [...new Set(ids.filter((n) => Number.isFinite(n)))];
  if (clean.length < 2) return [];
  return query<AttractionEdge>(
    `SELECT from_id, to_id, walk_m, walk_min, transit_mode, transit_line,
            transit_min, transit_transfers, source, transit_checked_at
       FROM attraction_edges
      WHERE from_id = ANY($1) AND to_id = ANY($1)`,
    [clean]
  );
}

// Stamp a city as "transit synced now" — set when we (re)run the GTFS/OTP fill
// for its edges, so the admin can see which cities are due a refresh.
export async function markTransitSynced(destId: number): Promise<void> {
  await query(`UPDATE destinations SET transit_synced_at = now() WHERE id = $1`, [destId]);
}

// --- Neighbourhoods / areas (feature C) --------------------------------------
export type Area = {
  id: number; name_he: string | null; name_en: string | null;
  lat: number; lng: number; radius_m: number | null;
  vibe_he: string | null; best_for: string[] | null; gateway_he: string | null;
  attraction_count: number | null; approved: boolean;
  kind: string; headline: boolean;
};

// Areas for a destination, biggest first. Used to label built days with their
// neighbourhood + gateway, and by the admin.
export async function areasForDestination(destId: number): Promise<Area[]> {
  return query<Area>(
    `SELECT id, name_he, name_en, lat, lng, radius_m, vibe_he, best_for, gateway_he,
            attraction_count, approved, kind, headline
       FROM areas WHERE destination_id = $1
      ORDER BY attraction_count DESC NULLS LAST`,
    [destId]
  );
}

// Headline neighbourhoods shown to the traveller on the city page as first-class
// experience cards (with how many must-sees they contain, for the framing).
export type AreaCard = {
  id: number; name_he: string | null; name_en: string | null; kind: string;
  vibe_he: string | null; best_for: string[] | null; gateway_he: string | null;
  attraction_count: number | null; must_count: number; lat: number; lng: number;
  member_ids: number[];
};
export async function headlineAreasForCity(destId: number): Promise<AreaCard[]> {
  return query<AreaCard>(
    `SELECT a.id, a.name_he, a.name_en, a.kind, a.vibe_he, a.best_for, a.gateway_he,
            a.attraction_count, a.lat, a.lng,
            (SELECT count(*)::int FROM attractions t WHERE t.area_id = a.id AND t.must_see = 1) AS must_count,
            (SELECT COALESCE(array_agg(t.id ORDER BY t.must_see DESC NULLS LAST, t.id), '{}')
               FROM attractions t WHERE t.area_id = a.id) AS member_ids
       FROM areas a
      WHERE a.destination_id = $1 AND a.headline = true AND a.approved = true
      ORDER BY a.attraction_count DESC NULLS LAST`,
    [destId]
  );
}

// --- Admin: distance graph transparency --------------------------------------
export type GraphStats = { edge_count: number; transit_edge_count: number; transit_synced_at: string | null };
export type GraphAttraction = { id: number; name_he: string | null; name_en: string; lat: number; lng: number; must_see: number };

// Graph coverage stats for a city + its top-N worthy attractions (with coords) so
// the admin can compute & show the walk/transit distance matrix.
export async function adminGraph(destId: number, n = 40): Promise<{ stats: GraphStats; attractions: GraphAttraction[] }> {
  const stats = (await query<GraphStats>(
    `SELECT (SELECT count(*)::int FROM attraction_edges WHERE destination_id = $1) AS edge_count,
            (SELECT count(*)::int FROM attraction_edges WHERE destination_id = $1 AND transit_mode IS NOT NULL) AS transit_edge_count,
            (SELECT transit_synced_at FROM destinations WHERE id = $1) AS transit_synced_at`,
    [destId]))[0] ?? { edge_count: 0, transit_edge_count: 0, transit_synced_at: null };
  const attractions = await query<GraphAttraction>(
    `SELECT id, name_he, name_en, lat, lng, COALESCE(must_see,0) AS must_see
       FROM attractions
      WHERE destination_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY must_see DESC NULLS LAST, (audience_fit->>'couples')::int DESC NULLS LAST, id
      LIMIT $2`,
    [destId, n]);
  return { stats, attractions };
}

// Editor-editable area fields (the admin neighbourhoods tab).
const AREA_EDITABLE = new Set(["name_he", "name_en", "vibe_he", "gateway_he", "best_for", "approved", "kind", "headline"]);

// The attractions tagged into each area of a city (for the admin to inspect &
// verify the auto-assignment).
export type AreaAttraction = {
  id: number; name_he: string | null; name_en: string; category: string;
  must_see: number; area_id: number;
};
export async function areaAttractions(destId: number): Promise<AreaAttraction[]> {
  return query<AreaAttraction>(
    `SELECT id, name_he, name_en, category, COALESCE(must_see,0) AS must_see, area_id
       FROM attractions
      WHERE destination_id = $1 AND area_id IS NOT NULL
      ORDER BY must_see DESC, id`,
    [destId]
  );
}

export async function updateArea(id: number, fields: Record<string, unknown>): Promise<boolean> {
  const entries = Object.entries(fields).filter(([k]) => AREA_EDITABLE.has(k));
  if (!entries.length) return false;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const vals = entries.map(([, v]) => v);
  await query(`UPDATE areas SET ${sets} WHERE id = $1`, [id, ...vals]);
  return true;
}
