"""One-time migration of the public reference data from SQLite to Supabase Postgres.

Moves destinations, attractions, settings and tickets (the per-user data —
profiles/trips/hotels — lives in browsers' localStorage and is imported per
user on first login, not here).

Usage:
    export DATABASE_URL='postgresql://...supabase...'   # service-role / direct conn
    python scripts/migrate_sqlite_to_pg.py --schema      # also create tables/RLS first
    python scripts/migrate_sqlite_to_pg.py               # data only (re-runnable upsert)

Needs: psycopg2-binary  (pip install psycopg2-binary)
Run from the repo root, against a copy/backup of the live SQLite DB.
"""
import argparse
import json
import os
import sqlite3
from pathlib import Path

import psycopg2
from psycopg2.extras import Json, execute_values

ROOT = Path(__file__).resolve().parent.parent

# table -> (columns, json_columns). Column order is shared by SELECT and INSERT.
TABLES = {
    "destinations": (
        ["id", "country", "region", "city", "city_he", "country_he", "name_he",
         "name_en", "lat", "lng", "description_he", "best_months",
         "israeli_popularity_score", "timezone", "currency", "language"],
        {"best_months"},
    ),
    "attractions": (
        ["id", "destination_id", "name_he", "name_en", "lat", "lng", "category",
         "subcategory", "indoor_outdoor", "duration_minutes", "price_usd",
         "min_age", "max_age", "family_score", "physical_intensity",
         "opening_hours", "rating_google", "rating_count", "description_he",
         "tips_he", "website", "video_links", "info_sources", "osm_id", "osm_type",
         "google_place_id", "quality_keep", "enriched_at", "image_url",
         "image_checked_at", "tagline_he", "best_season", "best_time_he",
         "dress_he", "cost_level", "must_see", "is_duplicate"],
        {"video_links", "info_sources"},
    ),
    "settings": (["key", "value"], set()),
    "tickets": (["id", "type", "title", "body", "images", "status", "created_at"],
                {"images"}),
}


def _json_or_none(val):
    if val is None or val == "":
        return None
    if isinstance(val, (list, dict)):
        return Json(val)
    try:
        return Json(json.loads(val))
    except (ValueError, TypeError):
        return None  # malformed JSON text — drop rather than break the row


def _sqlite_columns(scur, table):
    return {r[1] for r in scur.execute(f"PRAGMA table_info({table})")}


def migrate_table(scur, pg, table, columns, json_cols):
    available = _sqlite_columns(scur, table)
    cols = [c for c in columns if c in available]
    rows = scur.execute(f"SELECT {', '.join(cols)} FROM {table}").fetchall()
    if not rows:
        print(f"  {table}: 0 rows")
        return
    values = []
    for r in rows:
        rec = []
        for c, v in zip(cols, r):
            rec.append(_json_or_none(v) if c in json_cols else v)
        values.append(rec)

    collist = ", ".join(cols)
    pk = "key" if table == "settings" else "id"
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c != pk)
    sql = (f"INSERT INTO {table} ({collist}) VALUES %s "
           f"ON CONFLICT ({pk}) DO UPDATE SET {updates}")
    with pg.cursor() as cur:
        execute_values(cur, sql, values, page_size=500)
        # keep identity sequence ahead of imported ids (tickets)
        if table == "tickets":
            cur.execute("SELECT setval(pg_get_serial_sequence('tickets','id'), "
                        "COALESCE((SELECT MAX(id) FROM tickets), 1))")
    pg.commit()
    print(f"  {table}: {len(values)} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", default=str(ROOT / "data" / "nanabanana.db"))
    ap.add_argument("--schema", action="store_true", help="run schema.sql first")
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("set DATABASE_URL (Supabase connection string)")

    sconn = sqlite3.connect(args.sqlite)
    scur = sconn.cursor()
    pg = psycopg2.connect(dsn)

    if args.schema:
        print("applying schema.sql...")
        with pg.cursor() as cur:
            cur.execute((ROOT / "supabase" / "schema.sql").read_text())
        pg.commit()

    print(f"migrating from {args.sqlite}")
    # destinations before attractions (FK), settings/tickets independent
    for table in ("destinations", "attractions", "settings", "tickets"):
        cols, json_cols = TABLES[table]
        migrate_table(scur, pg, table, cols, json_cols)

    pg.close()
    sconn.close()
    print("done.")


if __name__ == "__main__":
    main()
