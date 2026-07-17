"""OpenStreetMap pipeline — pull tourist attractions via the Overpass API.

Free, no API key. Maps OSM tags into our attractions schema and records
the source links (website, Wikipedia, Wikidata) under info_sources.
"""
import time
import requests

import db

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
HEADERS = {"User-Agent": "NanaBanana/0.1 (trip planner; contact yaniv@eos-online.com)"}


def geocode_city(query):
    """Resolve a free-text city name to (city, country, lat, lng) via Nominatim.

    Returns None if not found. Free, no API key; respects the OSM usage policy
    (one request, User-Agent set).
    """
    resp = requests.get(
        NOMINATIM_URL,
        params={"q": query, "format": "jsonv2", "limit": 1,
                "addressdetails": 1, "accept-language": "en"},
        headers=HEADERS, timeout=20,
    )
    resp.raise_for_status()
    results = resp.json()
    if not results:
        return None
    r = results[0]
    addr = r.get("address", {})
    city = (addr.get("city") or addr.get("town") or addr.get("village")
            or addr.get("municipality") or r.get("name") or query)
    country = addr.get("country", "")
    return {"city": city, "country": country,
            "lat": float(r["lat"]), "lng": float(r["lon"])}

# OSM tag -> (our category, indoor/outdoor, rough family_score 1-10)
CATEGORY_MAP = {
    "tourism=attraction":   ("attraction", "both", 7),
    "tourism=museum":       ("museum", "indoor", 5),
    "tourism=zoo":          ("nature", "outdoor", 9),
    "tourism=theme_park":   ("attraction", "outdoor", 9),
    "tourism=viewpoint":    ("nature", "outdoor", 6),
    "tourism=gallery":      ("museum", "indoor", 4),
    "tourism=aquarium":     ("nature", "indoor", 9),
    "leisure=park":         ("nature", "outdoor", 8),
    "leisure=nature_reserve": ("nature", "outdoor", 7),
    "leisure=water_park":   ("sport", "outdoor", 9),
    "historic=castle":      ("attraction", "both", 7),
    "historic=fort":        ("attraction", "both", 7),
    "historic=fortress":    ("attraction", "both", 7),
    "historic=city_gate":   ("attraction", "outdoor", 6),
    "historic=ruins":       ("attraction", "outdoor", 6),
    "historic=archaeological_site": ("attraction", "outdoor", 6),
    "historic=tower":       ("attraction", "both", 6),
    "historic=monument":    ("attraction", "outdoor", 5),
    "leisure=garden":       ("nature", "outdoor", 8),
    "natural=peak":         ("nature", "outdoor", 5),
    "natural=waterfall":    ("nature", "outdoor", 8),
    "natural=beach":        ("nature", "outdoor", 9),
    # thermal/public baths — a genuine attraction (Tbilisi sulphur, Budapest)
    "amenity=public_bath":  ("attraction", "indoor", 7),
    # gaps found on Lefkada (2026-07-17): waterfalls are usually tagged
    # waterway=waterfall (not natural=), and monasteries — major attractions in
    # Greece/Georgia — are amenity=monastery.
    "waterway=waterfall":   ("nature", "outdoor", 8),
    "amenity=monastery":    ("attraction", "both", 6),
}


def _build_query(lat, lng, radius_m):
    """Overpass QL: all interesting tourism/leisure/historic/natural nodes+ways.

    Includes relations for tourism/leisure/historic — many major landmarks
    (fortresses, botanical gardens, large parks) are mapped as multipolygon
    relations, not nodes/ways, and were otherwise invisible.
    """
    tourism = 'attraction|museum|zoo|theme_park|viewpoint|gallery|aquarium'
    leisure = 'park|nature_reserve|water_park|garden'
    historic = 'castle|fort|fortress|city_gate|ruins|archaeological_site|tower|monument|memorial'
    filters = [
        f'node["tourism"~"{tourism}"]',
        f'way["tourism"~"{tourism}"]',
        f'relation["tourism"~"{tourism}"]',
        f'node["leisure"~"{leisure}"]',
        f'way["leisure"~"{leisure}"]',
        f'relation["leisure"~"{leisure}"]',
        f'node["historic"~"{historic}"]',
        f'way["historic"~"{historic}"]',
        f'relation["historic"~"{historic}"]',
        'node["natural"~"peak|waterfall"]',
        # beaches are usually mapped as ways (areas) — include both
        'node["natural"="beach"]',
        'way["natural"="beach"]',
        # thermal/public baths (Tbilisi sulphur baths, Budapest spa baths)
        'node["amenity"="public_bath"]',
        'way["amenity"="public_bath"]',
        # waterfalls are usually waterway=waterfall (Dimosari/Lefkada was missed)
        'node["waterway"="waterfall"]',
        # monasteries (Faneromeni/Lefkada, Jvari/Georgia…) are amenity=monastery
        'node["amenity"="monastery"]',
        'way["amenity"="monastery"]',
        'relation["amenity"="monastery"]',
    ]
    body = "".join(f'{f}(around:{radius_m},{lat},{lng});' for f in filters)
    return f"[out:json][timeout:60];({body});out center tags;"


def _classify(tags):
    for key in ("tourism", "leisure", "historic", "natural"):
        val = tags.get(key)
        if val:
            mapped = CATEGORY_MAP.get(f"{key}={val}")
            if mapped:
                return mapped
            return (key, "both", 5)  # known top-level key, unmapped value
    # amenity/waterway are huge namespaces — accept ONLY explicitly mapped values.
    for key in ("amenity", "waterway"):
        val = tags.get(key)
        if val:
            mapped = CATEGORY_MAP.get(f"{key}={val}")
            if mapped:
                return mapped
    return (None, "both", 5)


def _info_sources(tags):
    sources = []
    if tags.get("wikipedia"):
        # value like "en:Eiffel Tower"
        parts = tags["wikipedia"].split(":", 1)
        if len(parts) == 2:
            lang, title = parts
            url = f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}"
            sources.append({"title": "Wikipedia", "url": url})
    if tags.get("wikidata"):
        sources.append({
            "title": "Wikidata",
            "url": f"https://www.wikidata.org/wiki/{tags['wikidata']}",
        })
    return sources


def fetch_city(city, country, lat, lng, radius_km=15, sleep=1.0):
    """Pull attractions around a city center and store them.

    Returns dict with counts: {found, inserted, skipped}.
    """
    db.init_db()
    conn = db.get_conn()
    dest_id = db.upsert_destination(
        conn, country=country, city=city, name_en=city, lat=lat, lng=lng,
    )
    conn.commit()

    query = _build_query(lat, lng, int(radius_km * 1000))
    # Public Overpass rate-limits (429) and occasionally 504s — retry with backoff.
    elements = []
    for attempt in range(5):
        resp = requests.post(OVERPASS_URL, data={"data": query},
                             headers=HEADERS, timeout=120)
        if resp.status_code in (429, 502, 503, 504):
            time.sleep(30 * (attempt + 1))
            continue
        resp.raise_for_status()
        elements = resp.json().get("elements", [])
        break
    else:
        raise RuntimeError("Overpass unavailable after retries")

    inserted = skipped = 0
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name:en") or tags.get("name")
        if not name:
            continue
        category, indoor_outdoor, fam = _classify(tags)
        if not category:
            continue

        # coordinates: nodes have lat/lon; ways have "center"
        el_lat = el.get("lat") or el.get("center", {}).get("lat")
        el_lng = el.get("lon") or el.get("center", {}).get("lon")

        website = tags.get("website") or tags.get("contact:website") or tags.get("url")

        rid = db.upsert_attraction(
            conn,
            destination_id=dest_id,
            name_en=name,
            name_he=tags.get("name:he"),
            lat=el_lat,
            lng=el_lng,
            category=category,
            subcategory=tags.get("tourism") or tags.get("leisure")
                        or tags.get("historic") or tags.get("natural")
                        or tags.get("waterway") or tags.get("amenity"),
            indoor_outdoor=indoor_outdoor,
            family_score=fam,
            opening_hours=tags.get("opening_hours"),
            website=website,
            info_sources=_info_sources(tags),
            video_links=[],
            osm_id=str(el.get("id")),
            osm_type=el.get("type"),
        )
        if rid:
            inserted += 1
        else:
            skipped += 1

    conn.commit()
    conn.close()
    if sleep:
        time.sleep(sleep)  # be polite to the public Overpass instance
    return {"found": len(elements), "inserted": inserted, "skipped": skipped}


if __name__ == "__main__":
    # quick smoke test: Salzburg (the 50k-member group destination)
    result = fetch_city("Salzburg", "Austria", 47.8095, 13.0550, radius_km=12)
    print(result)
