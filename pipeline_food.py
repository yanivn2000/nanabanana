"""Food / shopping / nightlife ingest — Wikipedia-gated (pilot: London).

The base OSM pipeline deliberately skips amenity/shop (a huge namespace full of
non-notable cafés). This pass ingests ONLY places with a `wikipedia` tag — i.e.
notable enough that someone wrote an encyclopedia article about them — mapped
into our schema:

  amenity restaurant/cafe/food_court -> category food      (taste: food)
  amenity pub/bar/nightclub          -> category food      (taste: nightlife)
  amenity marketplace                -> category shopping  (taste: food+vintage)
  shop=*                             -> category shopping  (taste by shop kind)

Keyed on (osm_type, osm_id) like the base pipeline, so re-runs are idempotent
and never touch curated fields. taste_tags are set on NEW rows only.

Usage:  python pipeline_food.py <dest_id> [radius_km]   (dry run)
        python pipeline_food.py <dest_id> [radius_km] --apply
"""
import json
import sys
import time

import psycopg2.extras
import requests

import db

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {"User-Agent": "NanaBanana/0.1 (trip planner; contact yaniv@eos-online.com)"}

FOOD_AMENITIES = {"restaurant", "cafe", "food_court"}
NIGHT_AMENITIES = {"pub", "bar", "nightclub"}
# shop kinds → taste tag (everything else gets no tag; the קניות tile matches by category)
VINTAGE_SHOPS = {"antiques", "second_hand", "charity", "books", "vintage", "market"}
LUXURY_SHOPS = {"jewelry", "watches", "perfumery", "department_store", "boutique", "bag", "fashion_accessories"}
# Everyday-service shop kinds a tourist wouldn't visit as an attraction, even
# when the building/business happens to have a Wikipedia article.
SHOP_DENY = {"hairdresser", "travel_agency", "car", "paint", "frame", "beauty",
             "weapons", "supermarket", "stationery", "variety_store", "homewares",
             "convenience", "newsagent", "electronics", "video;music"}


def _query(lat, lng, radius_m):
    a = "restaurant|cafe|bar|pub|nightclub|marketplace|food_court"
    return (
        "[out:json][timeout:90];("
        f'nwr["amenity"~"^({a})$"]["wikipedia"](around:{radius_m},{lat},{lng});'
        f'nwr["shop"]["wikipedia"](around:{radius_m},{lat},{lng});'
        ");out center tags;"
    )


def _classify(tags):
    """-> (category, subcategory, indoor_outdoor, family_score, taste_tags) or None."""
    amen, shop = tags.get("amenity"), tags.get("shop")
    if amen in FOOD_AMENITIES:
        return ("food", amen, "indoor", 5, ["food"])
    if amen in NIGHT_AMENITIES:
        return ("food", amen, "indoor", 1, ["nightlife"])
    if amen == "marketplace":
        return ("shopping", "marketplace", "both", 6, ["food", "vintage_shopping"])
    if shop:
        if shop in SHOP_DENY:
            return None
        taste = (["vintage_shopping"] if shop in VINTAGE_SHOPS
                 else ["luxury_shopping"] if shop in LUXURY_SHOPS else [])
        return ("shopping", shop, "indoor", 4, taste)
    return None


def _info_sources(tags):
    out = []
    if tags.get("wikipedia"):
        parts = tags["wikipedia"].split(":", 1)
        if len(parts) == 2:
            lang, title = parts
            out.append({"title": "Wikipedia",
                        "url": f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}"})
    if tags.get("wikidata"):
        out.append({"title": "Wikidata",
                    "url": f"https://www.wikidata.org/wiki/{tags['wikidata']}"})
    return out


def _fetch_elements(lat, lng, radius_m):
    q = _query(lat, lng, radius_m)
    for attempt in range(6):
        url = OVERPASS_URLS[attempt % len(OVERPASS_URLS)]
        try:
            r = requests.post(url, data={"data": q}, headers=HEADERS, timeout=130)
            if r.status_code in (429, 502, 503, 504):
                raise RuntimeError(f"status {r.status_code}")
            r.raise_for_status()
            body = r.json()
            return body.get("elements", [])
        except Exception as e:  # noqa: BLE001 — retry across mirrors
            print(f"  overpass attempt {attempt + 1} ({url.split('/')[2]}): {e}", flush=True)
            time.sleep(15 * (attempt + 1))
    raise RuntimeError("Overpass unavailable after retries")


def ingest(dest_id, radius_km=14.0, apply=False):
    conn = db.get_conn()
    row = conn.execute("SELECT city, lat, lng FROM destinations WHERE id=?", (dest_id,)).fetchone()
    if not row:
        raise SystemExit(f"destination {dest_id} not found")
    city, lat, lng = row["city"], row["lat"], row["lng"]
    print(f"{city} (dest {dest_id}) — wikipedia-gated food/shopping/nightlife, r={radius_km}km apply={apply}")

    elements = _fetch_elements(lat, lng, int(radius_km * 1000))
    inserted = skipped = unnamed = 0
    by_kind = {}
    new_taste = {}  # id -> taste tags
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name:en") or tags.get("name")
        if not name:
            unnamed += 1
            continue
        cls = _classify(tags)
        if not cls:
            continue
        category, sub, indoor, fam, taste = cls
        by_kind[sub] = by_kind.get(sub, 0) + 1
        if not apply:
            continue
        rid = db.upsert_attraction(
            conn,
            destination_id=dest_id,
            name_en=name,
            name_he=tags.get("name:he"),
            lat=el.get("lat") or el.get("center", {}).get("lat"),
            lng=el.get("lon") or el.get("center", {}).get("lon"),
            category=category,
            subcategory=sub,
            indoor_outdoor=indoor,
            family_score=fam,
            opening_hours=tags.get("opening_hours"),
            website=tags.get("website") or tags.get("contact:website") or tags.get("url"),
            info_sources=_info_sources(tags),
            video_links=[],
            osm_id=str(el.get("id")),
            osm_type=el.get("type"),
        )
        if rid:
            inserted += 1
            if taste:
                new_taste[rid] = taste
        else:
            skipped += 1

    if apply and new_taste:
        cur = conn.cursor()
        for rid, taste in new_taste.items():
            cur.execute("UPDATE attractions SET taste_tags=%s WHERE id=%s",
                        (psycopg2.extras.Json(taste), rid))
        conn.commit()

    print(f"found={len(elements)} named-matched={sum(by_kind.values())} "
          f"inserted={inserted} already-there={skipped} unnamed={unnamed}")
    for k, c in sorted(by_kind.items(), key=lambda x: -x[1]):
        print(f"  {k}: {c}")
    conn.close()
    return inserted


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dest = int(args[0]) if args else 14  # default: London pilot
    radius = float(args[1]) if len(args) > 1 else 14.0
    ingest(dest, radius, apply="--apply" in sys.argv)
