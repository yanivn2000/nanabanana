"""Fill duration_minutes with a category/subcategory heuristic.

OSM gives us no visit-length data, so the itinerary builder had nothing to
schedule with (duration_minutes was 0% populated). This sets a sensible typical
visit length per subcategory (falling back to category), only where the value
is still NULL — so it's safe to re-run after a new ingest.

Feeds: web heuristic itinerary builder (day scheduling) + the attraction detail
"משך" line. Run:  python fill_duration.py --apply
"""
import sys
import db

# typical visit length in minutes, by OSM subcategory
BY_SUB = {
    "museum": 120, "gallery": 90, "castle": 90, "fort": 90, "fortress": 90,
    "archaeological_site": 90, "ruins": 60, "palace": 100, "tower": 40,
    "monument": 25, "memorial": 20, "artwork": 15, "technical_monument": 30,
    "city_gate": 20, "viewpoint": 25, "peak": 40, "park": 60, "garden": 60,
    "parklet": 20, "nature_reserve": 90, "dog_park": 30, "beach": 120,
    "zoo": 150, "aquarium": 90, "theme_park": 210, "water_park": 210,
    "trampoline_park": 90, "sports_centre": 90, "information": 10,
    "attraction": 60,
}
BY_CAT = {"museum": 110, "nature": 60, "historic": 45, "attraction": 60,
          "tourism": 45, "leisure": 60, "sport": 90}


def fill(apply=False):
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT id, category, subcategory FROM attractions "
        "WHERE duration_minutes IS NULL").fetchall()
    n = 0
    for r in rows:
        d = BY_SUB.get(r["subcategory"]) or BY_CAT.get(r["category"]) or 60
        if apply:
            conn.execute("UPDATE attractions SET duration_minutes=? WHERE id=?", (d, r["id"]))
        n += 1
    if apply:
        conn.commit()
    print(f"{'filled' if apply else 'would fill'} {n} rows")
    conn.close()
    return n


if __name__ == "__main__":
    fill(apply="--apply" in sys.argv)
