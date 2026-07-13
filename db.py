"""Postgres (Supabase) data layer for the admin/pipeline.

Drop-in replacement for the old SQLite db.py: exposes the same helpers
(get_conn, upsert_*, settings, populate_he_names) but talks to the shared
Supabase Postgres — the same database the consumer app on Vercel reads.

A thin shim makes psycopg2 look like the sqlite3 API the modules already use:
`conn.execute(sql, params).fetchone()/.fetchall()`, with rows that support both
`row[0]` and `row['col']` (psycopg2 DictRow). SQLite `?` placeholders and
`datetime('now')` are translated automatically.
"""
import json
import os
from pathlib import Path

import psycopg2
import psycopg2.extras

# Kept for the tickets image directory (db.DB_PATH.parent == the data dir).
DB_PATH = Path(__file__).parent / "data" / "nanabanana.db"
WEB_ENV = os.path.expanduser("~/.nanabanana-web.env")
LOCAL_ENV = Path(__file__).parent / "web" / ".env.local"

DEFAULT_MODEL = "claude-opus-4-8"


def _dsn():
    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        return dsn
    for path in (WEB_ENV, LOCAL_ENV):
        try:
            for line in open(path):
                if line.strip().startswith("DATABASE_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            continue
    raise RuntimeError("DATABASE_URL not set (env or ~/.nanabanana-web.env)")


def _translate(sql):
    return sql.replace("datetime('now')", "now()").replace("?", "%s")


class PgConn:
    """sqlite3-Connection-like wrapper over a psycopg2 connection."""

    def __init__(self, dsn):
        self._c = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.DictCursor)
        self._c.autocommit = True

    def execute(self, sql, params=()):
        cur = self._c.cursor()
        cur.execute(_translate(sql), params)
        return cur

    def cursor(self):
        return self._c.cursor()

    def commit(self):
        pass  # autocommit

    def rollback(self):
        try:
            self._c.rollback()
        except Exception:
            pass

    def close(self):
        try:
            self._c.close()
        except Exception:
            pass


def get_conn():
    return PgConn(_dsn())


def jloads(val):
    """jsonb columns come back as Python objects; legacy callers may pass a
    JSON string. Return a Python list/dict either way ([] for empty/None)."""
    if not val:
        return []
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except (ValueError, TypeError):
        return []


def init_db():
    """No-op: the Postgres schema already exists (see supabase/schema.sql)."""
    return None


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()


def get_model(conn):
    return get_setting(conn, "model", DEFAULT_MODEL)


CITY_HE = {
    "Salzburg": "זלצבורג", "Vienna": "וינה", "Berlin": "ברלין",
    "Budapest": "בודפשט", "Prague": "פראג", "Barcelona": "ברצלונה",
    "Rome": "רומא", "Athens": "אתונה", "Amsterdam": "אמסטרדם",
    "Thessaloniki": "תסלוניקי", "Larnaca": "לרנקה", "Batumi": "בטומי",
}
COUNTRY_HE = {
    "Austria": "אוסטריה", "Germany": "גרמניה", "Hungary": "הונגריה",
    "Czechia": "צ׳כיה", "Czech Republic": "צ׳כיה", "Spain": "ספרד",
    "Italy": "איטליה", "Greece": "יוון", "Netherlands": "הולנד",
    "Cyprus": "קפריסין", "Georgia": "גאורגיה",
}


def populate_he_names(conn):
    """Fill Hebrew city/country display names for known destinations."""
    for r in conn.execute("SELECT id, city, country FROM destinations").fetchall():
        conn.execute(
            "UPDATE destinations SET city_he=?, country_he=? WHERE id=?",
            (CITY_HE.get(r["city"]), COUNTRY_HE.get(r["country"]), r["id"]),
        )
    conn.commit()


def upsert_destination(conn, **kw):
    """Insert or fetch a destination by (country, city). Returns id."""
    row = conn.execute(
        "SELECT id FROM destinations WHERE country=? AND city=?",
        (kw.get("country"), kw.get("city")),
    ).fetchone()
    if row:
        return row["id"]
    cols = ["country", "region", "city", "name_he", "name_en", "lat", "lng",
            "description_he", "best_months", "israeli_popularity_score",
            "timezone", "currency", "language"]
    vals = [kw.get(c) for c in cols]
    if isinstance(kw.get("best_months"), (list, tuple)):
        vals[cols.index("best_months")] = psycopg2.extras.Json(list(kw["best_months"]))
    placeholders = ",".join("?" * len(cols))
    cur = conn.execute(
        f"INSERT INTO destinations ({','.join(cols)}) VALUES ({placeholders}) RETURNING id",
        vals,
    )
    return cur.fetchone()[0]


def upsert_attraction(conn, **kw):
    """Insert attraction keyed on (osm_type, osm_id). Returns id for a NEW row,
    None if it already existed. On conflict, backfills the notability signals
    (info_sources = wikidata/wikipedia, website) onto existing rows without
    touching any curated field — so a re-ingest enriches old rows too."""
    for jcol in ("video_links", "info_sources"):
        if isinstance(kw.get(jcol), (list, dict)):
            kw[jcol] = psycopg2.extras.Json(kw[jcol])
    cols = ["destination_id", "name_he", "name_en", "lat", "lng", "category",
            "subcategory", "indoor_outdoor", "duration_minutes", "price_usd",
            "min_age", "max_age", "family_score", "physical_intensity",
            "opening_hours", "rating_google", "rating_count", "description_he",
            "tips_he", "website", "video_links", "info_sources",
            "osm_id", "osm_type", "google_place_id"]
    vals = [kw.get(c) for c in cols]
    placeholders = ",".join("?" * len(cols))
    cur = conn.execute(
        f"INSERT INTO attractions ({','.join(cols)}) VALUES ({placeholders}) "
        "ON CONFLICT (osm_type, osm_id) DO UPDATE SET "
        "  info_sources = CASE WHEN attractions.info_sources IS NULL "
        "      OR attractions.info_sources::text IN ('[]', 'null') "
        "      THEN EXCLUDED.info_sources ELSE attractions.info_sources END, "
        "  website = COALESCE(attractions.website, EXCLUDED.website) "
        "RETURNING id, (xmax = 0) AS inserted",
        vals,
    )
    row = cur.fetchone()
    if not row:
        return None
    return row[0] if row["inserted"] else None


if __name__ == "__main__":
    c = get_conn()
    n = c.execute("SELECT count(*) FROM attractions").fetchone()[0]
    print(f"Postgres OK · {n} attractions")
    c.close()
