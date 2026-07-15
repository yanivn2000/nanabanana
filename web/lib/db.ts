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
  must_see: number | null;
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

export async function topAttractions(destinationId: number, limit = 40): Promise<Attraction[]> {
  // Prefer AI-kept, high-score attractions; fall back to any if none enriched yet.
  return query<Attraction>(
    `SELECT ${ATTR_COLS}
       FROM attractions
       WHERE destination_id = $1
         AND (quality_keep = 1 OR quality_keep IS NULL)
         AND (is_duplicate IS NULL OR is_duplicate = 0)
         AND (is_component IS NULL OR is_component = 0)
       ORDER BY COALESCE(must_see, 0) DESC,
                COALESCE(quality_keep = 1, false) DESC,
                ${NOTABLE} DESC,
                COALESCE(family_score, 0) DESC, name_en
       LIMIT $2`,
    [destinationId, limit]
  );
}

// Fetch specific attractions by id — used so the itinerary builder always has
// the traveler's exact picks as candidates, even ones ranked below the top pool.
export async function attractionsByIds(ids: number[]): Promise<Attraction[]> {
  if (!ids.length) return [];
  return query<Attraction>(`SELECT ${ATTR_COLS} FROM attractions WHERE id = ANY($1)`, [ids]);
}

export async function attractionsForMap(destinationId: number, limit = 200): Promise<Attraction[]> {
  return query<Attraction>(
    `SELECT ${ATTR_COLS}
       FROM attractions
       WHERE destination_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL
         AND (quality_keep = 1 OR quality_keep IS NULL)
         AND (is_duplicate IS NULL OR is_duplicate = 0)
         AND (is_component IS NULL OR is_component = 0)
       ORDER BY COALESCE(must_see, 0) DESC,
                COALESCE(quality_keep = 1, false) DESC,
                ${NOTABLE} DESC,
                COALESCE(family_score, 0) DESC, name_en
       LIMIT $2`,
    [destinationId, limit]
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
