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
};

const ATTR_COLS = `id, name_he, name_en, lat, lng, category, subcategory,
  indoor_outdoor, family_score, tips_he, website, duration_minutes,
  image_url, tagline_he, best_season, best_time_he, dress_he, cost_level, must_see`;

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

const DEST_SELECT = `SELECT dest.id, dest.city, dest.country, dest.city_he,
         dest.country_he, dest.lat, dest.lng, count(a.id)::int AS attraction_count
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
       ORDER BY COALESCE(quality_keep = 1, false) DESC,
                COALESCE(family_score, 0) DESC, name_en
       LIMIT $2`,
    [destinationId, limit]
  );
}

export async function attractionsForMap(destinationId: number, limit = 200): Promise<Attraction[]> {
  return query<Attraction>(
    `SELECT ${ATTR_COLS}
       FROM attractions
       WHERE destination_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL
         AND (quality_keep = 1 OR quality_keep IS NULL)
         AND (is_duplicate IS NULL OR is_duplicate = 0)
       ORDER BY COALESCE(family_score, 0) DESC, name_en
       LIMIT $2`,
    [destinationId, limit]
  );
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
