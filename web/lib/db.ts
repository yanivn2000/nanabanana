import { Pool } from "pg";

// Postgres (Supabase) connection. Reads DATABASE_URL from the environment.
// A single pool is reused across hot-reloads / serverless invocations.
const g = globalThis as unknown as { _nbPool?: Pool };

function pool(): Pool | null {
  if (!process.env.DATABASE_URL) return null; // graceful: app still builds/runs
  if (!g._nbPool) {
    g._nbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Supabase pooler uses TLS
      max: 5,
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
};

const ATTR_COLS = `id, name_he, name_en, lat, lng, category, subcategory,
  indoor_outdoor, family_score, tips_he, website, duration_minutes,
  image_url, tagline_he, best_season, best_time_he, dress_he, cost_level, must_see,
  description_he, taste_tags`;

export type Destination = {
  id: number;
  city: string;
  country: string;
  city_he: string | null;
  country_he: string | null;
  lat: number;
  lng: number;
  attraction_count: number;
};

// A row is "shown" in the consumer app: kept-or-unassessed, not a dup/component.
const SHOWN = `(a.quality_keep = 1 OR a.quality_keep IS NULL)
  AND (a.is_duplicate IS NULL OR a.is_duplicate = 0)
  AND (a.is_component IS NULL OR a.is_component = 0)`;
// Notability signal: mapped in OSM with a Wikipedia/Wikidata entry.
const NOTABLE = `(info_sources IS NOT NULL AND info_sources::text NOT IN ('[]', 'null'))`;

const DEST_SELECT = `SELECT dest.id, dest.city, dest.country, dest.city_he,
         dest.country_he, dest.lat, dest.lng,
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
  `${EFF_MUST} AS must_see, a.must_see AS osm_must_see, ep.rank AS editor_rank, ep.kids AS editor_kids`);

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
  shown_count: number; must_count: number; editor_ranked: number; img_pct: number; he_pct: number;
};

// Every destination with its full record + content-health stats for the admin.
export async function adminDestinations(): Promise<AdminDestination[]> {
  return query<AdminDestination>(
    `SELECT d.id, d.city, d.country, d.region, d.city_he, d.country_he, d.lat, d.lng,
            d.description_he, d.best_months, d.israeli_popularity_score,
            d.timezone, d.currency, d.language,
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
  "timezone", "currency", "language",
]);

export async function updateDestination(id: number, fields: Record<string, unknown>): Promise<boolean> {
  const entries = Object.entries(fields).filter(([k]) => DEST_EDITABLE.has(k));
  if (!entries.length) return false;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const vals = entries.map(([k, v]) => (k === "best_months" && Array.isArray(v) ? JSON.stringify(v) : v));
  await query(`UPDATE destinations SET ${sets} WHERE id = $1`, [id, ...vals]);
  return true;
}

// --- Admin: insights ingest (the knowledge layer) ----------------------------
// Port of the Streamlit tool's save/match (insights.py): distilled traveller
// insights are saved per-author as `sources` rows, each insight matched to one
// of our attractions by token overlap where possible.

export type IngestItem = { place: string; kind: string; text_he: string; sentiment: string; author?: string };

const MATCH_STOP = new Set([
  "the", "de", "van", "der", "den", "het", "een", "a", "of", "and", "und",
  "la", "le", "el", "il", "at", "in", "on", "st",
  "park", "garden", "gardens", "museum", "house", "home", "palace", "castle",
  "church", "square", "market", "street", "bridge", "tower", "cathedral",
  "gallery", "center", "centre", "old", "new", "great", "royal",
  "פארק", "גן", "גני", "מוזיאון", "בית", "הבית", "ארמון", "טירה", "כנסייה",
  "כיכר", "שוק", "רחוב", "גשר", "מגדל", "קתדרלה", "גלריה", "מרכז", "של", "עם",
]);
const mNorm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().split("").filter((ch) => /[\p{L}\p{N}\s]/u.test(ch)).join("").trim();
const mToks = (s: string | null | undefined) =>
  new Set(mNorm(s).split(/\s+/).filter((t) => t.length >= 2));
const diff = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => !b.has(x)));
const okAnchor = (core: Set<string>) =>
  core.size >= 2 || (core.size === 1 && [...core][0].length >= 4);

type MatchRow = { id: number; name_en: string; name_he: string | null; fs: number; ms: number };

function matchAttraction(rows: MatchRow[], city: Set<string>, placeName: string): number | null {
  const place = mNorm(placeName);
  const pcore = diff(diff(mToks(placeName), MATCH_STOP), city);
  if (place.length < 3 || !pcore.size) return null;
  let best: { s: number; id: number } | null = null;
  for (const r of rows) {
    let cand: number | null = null;
    for (const name of [r.name_en, r.name_he]) {
      const n = mNorm(name);
      if (!n) continue;
      const ncore = diff(diff(mToks(name), MATCH_STOP), city);
      let s: number | null = null;
      const inter = new Set([...pcore].filter((x) => ncore.has(x)));
      if (n === place) s = 100;
      else if (pcore.size && ncore.size && inter.size === pcore.size && okAnchor(pcore))
        s = 68 + Math.floor(24 * pcore.size / ncore.size);
      else if (pcore.size && ncore.size && inter.size === ncore.size && okAnchor(ncore))
        s = 62 + Math.floor(20 * ncore.size / pcore.size);
      else if (inter.size) {
        const jac = inter.size / new Set([...pcore, ...ncore]).size;
        if (jac >= 0.6 && okAnchor(inter)) s = 55 + Math.floor(18 * jac);
      }
      if (s !== null && (cand === null || s > cand)) cand = s;
    }
    if (cand === null) continue;
    cand += 0.1 * r.fs + (r.ms ? 2 : 0);
    if (!best || cand > best.s) best = { s: cand, id: r.id };
  }
  return best && best.s >= 62 ? best.id : null;
}

// Persist approved insights, grouped per author into `sources` rows.
export async function saveInsights(
  destinationId: number, url: string | null, defaultAuthor: string | null,
  rawText: string, items: IngestItem[]
): Promise<{ sources: number; saved: number; matched: number }> {
  const dest = await query<{ city: string; city_he: string | null }>(
    `SELECT city, city_he FROM destinations WHERE id = $1`, [destinationId]);
  const city = new Set([...mToks(dest[0]?.city), ...mToks(dest[0]?.city_he)]);
  const rows = await query<MatchRow>(
    `SELECT id, name_en, name_he, COALESCE(family_score,0)::int AS fs, COALESCE(must_see,0)::int AS ms
       FROM attractions WHERE destination_id = $1
        AND (is_duplicate IS NULL OR is_duplicate = 0)
        AND (is_component IS NULL OR is_component = 0)`, [destinationId]);

  const groups = new Map<string | null, IngestItem[]>();
  for (const it of items) {
    const author = (it.author || defaultAuthor || "").trim() || null;
    (groups.get(author) ?? groups.set(author, []).get(author)!).push(it);
  }
  let saved = 0, matched = 0, sources = 0;
  for (const [author, group] of groups) {
    const src = await query<{ id: number }>(
      `INSERT INTO sources (destination_id, url, author, raw_text, created_at)
       VALUES ($1,$2,$3,$4,now()) RETURNING id`, [destinationId, url, author, rawText]);
    const sourceId = src[0].id;
    sources++;
    for (const it of group) {
      const aid = matchAttraction(rows, city, it.place || "");
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
  const rows = await query<SharedTrip>(`SELECT * FROM shared_trips WHERE slug = $1`, [slug]);
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
      WHERE destination_id = $1
      ORDER BY likes DESC, created_at DESC
      LIMIT $2`,
    [destId, limit]);
}

export async function countSharedTripsForDestination(destId: number): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM shared_trips WHERE destination_id = $1`, [destId]);
  return rows[0]?.n ?? 0;
}

// Anonymous like toggle (dedup is client-side via localStorage). Clamped ≥ 0.
export async function likeSharedTrip(slug: string, on: boolean): Promise<number | null> {
  const rows = await query<{ likes: number }>(
    `UPDATE shared_trips
        SET likes = GREATEST(0, likes + $2)
      WHERE slug = $1 RETURNING likes`,
    [slug, on ? 1 : -1]);
  return rows[0]?.likes ?? null;
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
