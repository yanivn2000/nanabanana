"""Street photos with COORDINATE VERIFICATION. For each approved street, search
Wikipedia ("<name> <city>"), but only accept a candidate article's lead image if
the article's own coordinates sit within ~2km of the street — this rejects
homonyms (an actor named "Neal", a person "Cler…"), maps, and same-named places
in other cities. No coords on the article → reject (people have none). Famous
streets get a correct photo; the rest stay blank for a hand-supplied image.
"""
import sys, time, requests
from pathlib import Path
from math import radians, sin, cos, atan2, sqrt
sys.path.insert(0, str(Path(__file__).resolve().parent))
import db

UA = {"User-Agent": "Yalle/1.0 (hello@yalle.co)"}
LANG = {"United Kingdom": "en", "United States": "en", "Netherlands": "nl", "France": "fr",
        "Spain": "es", "Italy": "it", "Germany": "de", "Portugal": "pt", "Greece": "el",
        "Austria": "de", "Czechia": "cs", "Hungary": "hu", "Poland": "pl", "Georgia": "ka",
        "Romania": "ro", "Bulgaria": "bg", "Israel": "he"}


def hav(a, b, c, d):
    R = 6371000
    dLa, dLo = radians(c - a), radians(d - b)
    x = sin(dLa / 2) ** 2 + cos(radians(a)) * cos(radians(c)) * sin(dLo / 2) ** 2
    return R * 2 * atan2(sqrt(x), sqrt(1 - x))


def verified_image(lang, title, lat, lng):
    """Return the lead image ONLY if the article's coords are near the street."""
    try:
        r = requests.get(f"https://{lang}.wikipedia.org/w/api.php", params={
            "action": "query", "prop": "pageimages|coordinates", "piprop": "original",
            "titles": title, "redirects": 1, "format": "json"}, headers=UA, timeout=15).json()
        for p in (r.get("query", {}).get("pages", {}) or {}).values():
            src = (p.get("original") or {}).get("source")
            if not src or not any(src.lower().endswith(e) for e in (".jpg", ".jpeg", ".png")):
                return None
            coords = p.get("coordinates")
            if not coords:
                return None   # no coords (e.g. a person) → reject
            if hav(lat, lng, coords[0]["lat"], coords[0]["lon"]) <= 2000:
                return src
    except Exception:
        pass
    return None


def find_image(name, city, lat, lng, langs):
    for lang in langs:
        try:
            r = requests.get(f"https://{lang}.wikipedia.org/w/api.php", params={
                "action": "query", "list": "search", "srsearch": f"{name} {city}",
                "srlimit": 4, "format": "json"}, headers=UA, timeout=15).json()
            for hit in r.get("query", {}).get("search", []):
                img = verified_image(lang, hit["title"], lat, lng)
                if img:
                    return img
        except Exception:
            pass
        time.sleep(0.4)
    return None


conn = db.get_conn()
# Clear the earlier best-effort (unverified) images so wrong ones don't linger.
conn.execute("UPDATE streets SET image_url = NULL WHERE approved = true")
rows = conn.execute(
    "SELECT s.id, s.name_en, s.name_he, s.lat, s.lng, d.city, d.country "
    "FROM streets s JOIN destinations d ON d.id = s.destination_id "
    "WHERE s.approved = true AND s.lat IS NOT NULL"
).fetchall()
print(f"{len(rows)} approved streets — fetching verified images", flush=True)
found = 0
for r in rows:
    langs = ["en"]
    loc = LANG.get(r["country"])
    if loc and loc != "en":
        langs.append(loc)
    img = find_image(r["name_en"], r["city"], r["lat"], r["lng"], langs)
    if img:
        conn.execute("UPDATE streets SET image_url=%s WHERE id=%s", (img, r["id"]))
        found += 1
        print(f"  ✓ {r['name_he'] or r['name_en']} ({r['city']})", flush=True)
conn.close()
print(f"DONE — {found}/{len(rows)} streets got a VERIFIED image", flush=True)
