"""One-off: build the El Al direct-flight cities missing from Yalle.

Per city (idempotent — fetch_city upserts, images/enrich only fill gaps):
  1. OSM ingest (radius 12km core)  -> destination + attractions
  2. set city_he / country_he / mobility=metro / ingest_radius_km
  3. Wikimedia images
Then globally, once (only NEW rows lack descriptions, so old cities are untouched):
  4. enrich_grounded --set notable --apply   (Hebrew from the OSM wiki link)
  5. fill_names --apply                        (Hebrew names)
  6. taste_tag --all --apply                   (taste tags)
  7. hide no-story junk in the new dests       (quality_keep=0; keeps pages clean)

Usage:  python build_cities.py            (all phases)
        python build_cities.py --ingest-only
        python build_cities.py --enrich-only
"""
import sys, time, subprocess, traceback
from pathlib import Path
ROOT = str(Path(__file__).resolve().parent)   # the repo, wherever it is cloned
sys.path.insert(0, ROOT)
import db, pipeline_osm, pipeline_images

RADIUS = 12  # km — the tourist core; metro cities, curate wider later

# city, country (English, as our region/flag maps expect), city_he, country_he, lat, lng
CITIES = [
    # --- confirmed year-round ---
    ("Frankfurt", "Germany", "פרנקפורט", "גרמניה", 50.1109, 8.6821),
    ("Geneva", "Switzerland", "ז'נבה", "שווייץ", 46.2044, 6.1432),
    ("Warsaw", "Poland", "ורשה", "פולין", 52.2297, 21.0122),
    ("Sofia", "Bulgaria", "סופיה", "בולגריה", 42.6977, 23.3219),
    ("Dubai", "United Arab Emirates", "דובאי", "איחוד האמירויות", 25.2048, 55.2708),
    ("Bangkok", "Thailand", "בנגקוק", "תאילנד", 13.7563, 100.5018),
    ("Tokyo", "Japan", "טוקיו", "יפן", 35.6762, 139.6503),
    ("Boston", "United States", "בוסטון", "ארצות הברית", 42.3601, -71.0589),
    ("Miami", "United States", "מיאמי", "ארצות הברית", 25.7743, -80.1937),
    ("Los Angeles", "United States", "לוס אנג'לס", "ארצות הברית", 34.0522, -118.2437),
    # --- seasonal (mostly Sundor) ---
    ("Marseille", "France", "מרסיי", "צרפת", 43.2965, 5.3698),
    ("Naples", "Italy", "נאפולי", "איטליה", 40.8518, 14.2681),
    ("Catania", "Italy", "קטניה", "איטליה", 37.5079, 15.0830),
    ("Cagliari", "Italy", "קליארי", "איטליה", 39.2238, 9.1217),
    ("Copenhagen", "Denmark", "קופנהגן", "דנמרק", 55.6761, 12.5683),
    ("Zagreb", "Croatia", "זאגרב", "קרואטיה", 45.8150, 15.9819),
    ("Dubrovnik", "Croatia", "דוברובניק", "קרואטיה", 42.6507, 18.0944),
    ("Tivat", "Montenegro", "טיבט", "מונטנגרו", 42.4370, 18.6970),
    ("Phuket", "Thailand", "פוקט", "תאילנד", 7.8804, 98.3923),
    # --- newly announced / future launch (real cities regardless of date) ---
    ("San Francisco", "United States", "סן פרנסיסקו", "ארצות הברית", 37.7749, -122.4194),
    ("Buenos Aires", "Argentina", "בואנוס איירס", "ארגנטינה", -34.6037, -58.3816),
    ("Hanoi", "Vietnam", "האנוי", "וייטנאם", 21.0278, 105.8342),
    ("Seoul", "South Korea", "סיאול", "קוריאה הדרומית", 37.5665, 126.9780),
    ("Manila", "Philippines", "מנילה", "פיליפינים", 14.5995, 120.9842),
    # --- single-source / ambiguous (plausibly seasonal Sundor) ---
    ("Lyon", "France", "ליון", "צרפת", 45.7640, 4.8357),
    ("Basel", "Switzerland", "באזל", "שווייץ", 47.5596, 7.5886),
    ("Varna", "Bulgaria", "ורנה", "בולגריה", 43.2141, 27.9147),
    ("Belgrade", "Serbia", "בלגרד", "סרביה", 44.7866, 20.4489),
    ("Tirana", "Albania", "טירנה", "אלבניה", 41.3275, 19.8187),
    ("Chisinau", "Moldova", "קישינב", "מולדובה", 47.0105, 28.8638),
    ("Santorini", "Greece", "סנטוריני", "יוון", 36.3932, 25.4615),
    ("Mykonos", "Greece", "מיקונוס", "יוון", 37.4467, 25.3289),
    ("Kefalonia", "Greece", "קפלוניה", "יוון", 38.1750, 20.5680),
]


def log(m):
    print(m, flush=True)


def dest_id_for(city, country):
    conn = db.get_conn()
    row = conn.execute(
        "SELECT id FROM destinations WHERE city=%s AND country=%s", (city, country)
    ).fetchone()
    conn.close()
    return row[0] if row else None


def set_meta(dest_id, city_he, country_he):
    conn = db.get_conn()
    conn.execute(
        "UPDATE destinations SET city_he=%s, country_he=COALESCE(country_he,%s), "
        "mobility=COALESCE(mobility,'metro'), ingest_radius_km=COALESCE(ingest_radius_km,%s) "
        "WHERE id=%s",
        (city_he, country_he, RADIUS, dest_id),
    )
    conn.close()


def phase_ingest():
    new_ids = []
    for i, (city, country, he, che, lat, lng) in enumerate(CITIES, 1):
        try:
            log(f"[{i}/{len(CITIES)}] INGEST {city}, {country} …")
            res = pipeline_osm.fetch_city(city, country, lat, lng, radius_km=RADIUS, sleep=1.0)
            log(f"    osm: {res}")
            did = dest_id_for(city, country)
            if not did:
                log(f"    !! no dest row for {city}; skipping")
                continue
            new_ids.append(did)
            set_meta(did, he, che)
            log(f"    dest {did} · city_he={he}")
            img = pipeline_images.fetch_images(destination_id=did, limit=100000, sleep=0.25)
            log(f"    images: {img}")
        except Exception as e:
            log(f"    ERROR {city}: {e}\n{traceback.format_exc()}")
        time.sleep(1)
    return new_ids


def run(cmd):
    log(f"$ {' '.join(cmd)}")
    p = subprocess.run([sys.executable] + cmd, cwd=ROOT)
    log(f"    exit={p.returncode}")


def hide_junk():
    ids = [dest_id_for(c, co) for c, co, *_ in CITIES]
    ids = [d for d in ids if d]
    conn = db.get_conn()
    cur = conn.execute(
        "UPDATE attractions SET quality_keep=0 "
        "WHERE destination_id = ANY(%s) "
        "  AND (must_see IS DISTINCT FROM 1) "
        "  AND (description_he IS NULL OR description_he='') "
        "  AND (image_url IS NULL OR image_url='') "
        "  AND (info_sources IS NULL OR info_sources::text IN ('[]','null'))",
        (ids,),
    )
    try:
        n = cur.rowcount
    except Exception:
        n = "?"
    conn.close()
    log(f"    hid {n} no-story rows across {len(ids)} new dests")


if __name__ == "__main__":
    ingest_only = "--ingest-only" in sys.argv
    enrich_only = "--enrich-only" in sys.argv

    if not enrich_only:
        log("=== PHASE A: ingest + meta + images ===")
        phase_ingest()

    if not ingest_only:
        log("=== PHASE B: grounded Hebrew (notable) ===")
        run(["enrich_grounded.py", "--set", "notable", "--apply"])
        log("=== PHASE C: Hebrew names ===")
        run(["fill_names.py", "--apply"])
        log("=== PHASE D: taste tags ===")
        run(["taste_tag.py", "--all", "--apply"])
        log("=== PHASE E: hide no-story junk ===")
        hide_junk()

    log("=== ALL DONE ===")
