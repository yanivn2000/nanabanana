import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// The same SQLite file the Streamlit data tool fills. Override with NANABANANA_DB.
const DB_PATH =
  process.env.NANABANANA_DB ||
  path.join(process.cwd(), "..", "data", "nanabanana.db");

let _db: Database.Database | null = null;

function db(): Database.Database | null {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) return null; // graceful: app still builds/runs
  _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return _db;
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

export function listDestinations(): Destination[] {
  const d = db();
  if (!d) return [];
  return d
    .prepare(
      `SELECT dest.id, dest.city, dest.country, dest.city_he, dest.country_he,
              dest.lat, dest.lng, count(a.id) AS attraction_count
       FROM destinations dest
       LEFT JOIN attractions a ON a.destination_id = dest.id
       GROUP BY dest.id ORDER BY attraction_count DESC`
    )
    .all() as Destination[];
}

export function topAttractions(destinationId: number, limit = 40): Attraction[] {
  const d = db();
  if (!d) return [];
  // Prefer AI-kept, high-score attractions; fall back to any if none enriched yet.
  const rows = d
    .prepare(
      `SELECT ${ATTR_COLS}
       FROM attractions
       WHERE destination_id = ?
         AND (quality_keep = 1 OR quality_keep IS NULL)
         AND (is_duplicate IS NULL OR is_duplicate = 0)
       ORDER BY (quality_keep = 1) DESC,
                COALESCE(family_score, 0) DESC, name_en
       LIMIT ?`
    )
    .all(destinationId, limit) as Attraction[];
  return rows;
}

export function getDestination(id: number): Destination | null {
  const d = db();
  if (!d) return null;
  return (
    (d
      .prepare(
        `SELECT dest.id, dest.city, dest.country, dest.city_he, dest.country_he,
                dest.lat, dest.lng, count(a.id) AS attraction_count
         FROM destinations dest
         LEFT JOIN attractions a ON a.destination_id = dest.id
         WHERE dest.id = ? GROUP BY dest.id`
      )
      .get(id) as Destination | undefined) ?? null
  );
}

export function attractionsForMap(destinationId: number, limit = 200): Attraction[] {
  const d = db();
  if (!d) return [];
  return d
    .prepare(
      `SELECT ${ATTR_COLS}
       FROM attractions
       WHERE destination_id = ? AND lat IS NOT NULL AND lng IS NOT NULL
         AND (quality_keep = 1 OR quality_keep IS NULL)
         AND (is_duplicate IS NULL OR is_duplicate = 0)
       ORDER BY COALESCE(family_score, 0) DESC, name_en
       LIMIT ?`
    )
    .all(destinationId, limit) as Attraction[];
}

// Shared AI model setting (written by the Streamlit admin Settings tab).
export function getModel(): string {
  const fallback = process.env.NANABANANA_MODEL || "claude-opus-4-8";
  const d = db();
  if (!d) return fallback;
  try {
    const row = d.prepare("SELECT value FROM settings WHERE key='model'").get() as
      | { value: string }
      | undefined;
    return row?.value || fallback;
  } catch {
    return fallback;
  }
}

export function dataReady(): boolean {
  return db() !== null;
}
