"""SQLite schema and helpers for NanaBanana.

One file, one DB. Start simple (SQLite), migrate to Postgres when we grow.
"""
import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "nanabanana.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country TEXT,
    region TEXT,
    city TEXT,
    name_he TEXT,
    name_en TEXT,
    lat REAL,
    lng REAL,
    description_he TEXT,
    best_months TEXT,                -- JSON array e.g. [6,7,8]
    israeli_popularity_score INTEGER,-- 1-100
    timezone TEXT,
    currency TEXT,
    language TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(country, city)
);

CREATE TABLE IF NOT EXISTS attractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destination_id INTEGER REFERENCES destinations(id),
    name_he TEXT,
    name_en TEXT,
    lat REAL,
    lng REAL,
    category TEXT,                   -- nature/museum/sport/shopping/food
    subcategory TEXT,
    indoor_outdoor TEXT,             -- indoor/outdoor/both
    duration_minutes INTEGER,
    price_usd REAL,
    min_age INTEGER,
    max_age INTEGER,
    family_score INTEGER,            -- 1-10
    physical_intensity INTEGER,      -- 1-5
    opening_hours TEXT,              -- raw OSM opening_hours string
    rating_google REAL,
    rating_count INTEGER,
    description_he TEXT,
    tips_he TEXT,
    website TEXT,                    -- official site link
    video_links TEXT,               -- JSON array of YouTube/video URLs
    info_sources TEXT,              -- JSON array of {title,url} we pulled data from
    osm_id TEXT,
    osm_type TEXT,                   -- node/way/relation
    google_place_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(osm_type, osm_id)
);

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT,                -- attraction/destination
    entity_id INTEGER,
    type TEXT,                       -- photo/video
    url TEXT,
    thumbnail_url TEXT,
    source TEXT,                     -- google/wikipedia/youtube/osm
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_attr_dest ON attractions(destination_id);
CREATE INDEX IF NOT EXISTS idx_attr_cat ON attractions(category);
"""

# Default AI model, shared by both apps. Override via the admin Settings tab.
DEFAULT_MODEL = "claude-opus-4-8"


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

# Columns added after the initial schema shipped — applied idempotently on init.
MIGRATIONS = [
    ("attractions", "quality_keep", "INTEGER"),   # 1=worth visiting, 0=skip (AI-judged)
    ("attractions", "enriched_at", "TEXT"),        # when the AI enrichment ran
    ("attractions", "image_url", "TEXT"),          # thumbnail from Wikipedia/Wikidata
    ("attractions", "image_checked_at", "TEXT"),   # when we looked for an image
    ("attractions", "tagline_he", "TEXT"),         # memorable one-liner (AI-generated)
]


def _apply_migrations(conn):
    for table, col, coltype in MIGRATIONS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}")


def get_conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    _apply_migrations(conn)
    conn.commit()
    conn.close()


def upsert_destination(conn, **kw):
    """Insert or fetch a destination by (country, city). Returns id."""
    cur = conn.execute(
        "SELECT id FROM destinations WHERE country=? AND city=?",
        (kw.get("country"), kw.get("city")),
    )
    row = cur.fetchone()
    if row:
        return row["id"]
    cols = ["country", "region", "city", "name_he", "name_en", "lat", "lng",
            "description_he", "best_months", "israeli_popularity_score",
            "timezone", "currency", "language"]
    vals = [kw.get(c) for c in cols]
    if isinstance(kw.get("best_months"), (list, tuple)):
        vals[cols.index("best_months")] = json.dumps(kw["best_months"])
    placeholders = ",".join("?" * len(cols))
    cur = conn.execute(
        f"INSERT INTO destinations ({','.join(cols)}) VALUES ({placeholders})",
        vals,
    )
    return cur.lastrowid


def upsert_attraction(conn, **kw):
    """Insert attraction keyed on (osm_type, osm_id). Skip if exists."""
    for jcol in ("video_links", "info_sources"):
        if isinstance(kw.get(jcol), (list, dict)):
            kw[jcol] = json.dumps(kw[jcol], ensure_ascii=False)
    cols = ["destination_id", "name_he", "name_en", "lat", "lng", "category",
            "subcategory", "indoor_outdoor", "duration_minutes", "price_usd",
            "min_age", "max_age", "family_score", "physical_intensity",
            "opening_hours", "rating_google", "rating_count", "description_he",
            "tips_he", "website", "video_links", "info_sources",
            "osm_id", "osm_type", "google_place_id"]
    vals = [kw.get(c) for c in cols]
    placeholders = ",".join("?" * len(cols))
    try:
        cur = conn.execute(
            f"INSERT INTO attractions ({','.join(cols)}) VALUES ({placeholders})",
            vals,
        )
        return cur.lastrowid
    except sqlite3.IntegrityError:
        return None  # already exists


if __name__ == "__main__":
    init_db()
    print(f"DB ready at {DB_PATH}")
