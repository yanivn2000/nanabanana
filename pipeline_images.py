"""Image pipeline — pull a thumbnail for each attraction from free sources.

Uses the Wikipedia/Wikidata links we already stored in info_sources:
- Wikipedia → REST summary API → thumbnail
- Wikidata  → entity P18 (image) → Wikimedia Commons FilePath thumb

No API key. Be polite (rate-limited, User-Agent set).
"""
import json
import time
import urllib.parse
import requests

import db

HEADERS = {"User-Agent": "NanaBanana/0.1 (trip planner; yaniv@eos-online.com)"}
COMMONS_THUMB = "https://commons.wikimedia.org/wiki/Special:FilePath/{file}?width=480"


def _from_wikipedia(url):
    # url like https://de.wikipedia.org/wiki/Schloss_X
    try:
        parsed = urllib.parse.urlparse(url)
        lang = parsed.netloc.split(".")[0]
        title = parsed.path.split("/wiki/", 1)[1]
    except Exception:
        return None
    api = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}"
    r = requests.get(api, headers=HEADERS, timeout=20)
    if r.status_code != 200:
        return None
    data = r.json()
    return (data.get("thumbnail") or {}).get("source") \
        or (data.get("originalimage") or {}).get("source")


def _from_wikidata(url):
    # url like https://www.wikidata.org/wiki/Q12345
    qid = url.rstrip("/").split("/")[-1]
    api = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
    r = requests.get(api, headers=HEADERS, timeout=20)
    if r.status_code != 200:
        return None
    try:
        claims = r.json()["entities"][qid]["claims"]
        filename = claims["P18"][0]["mainsnak"]["datavalue"]["value"]
    except (KeyError, IndexError):
        return None
    return COMMONS_THUMB.format(file=urllib.parse.quote(filename.replace(" ", "_")))


def find_image(info_sources_json):
    """Try Wikipedia first (better thumbs), then Wikidata. Returns URL or None."""
    if not info_sources_json:
        return None
    try:
        sources = json.loads(info_sources_json)
    except Exception:
        return None
    wiki = next((s["url"] for s in sources if s.get("title") == "Wikipedia"), None)
    wd = next((s["url"] for s in sources if s.get("title") == "Wikidata"), None)
    if wiki:
        img = _from_wikipedia(wiki)
        if img:
            return img
    if wd:
        return _from_wikidata(wd)
    return None


def pending_count(conn):
    return conn.execute(
        "SELECT count(*) FROM attractions "
        "WHERE image_checked_at IS NULL AND info_sources NOT IN ('', '[]') "
        "AND info_sources IS NOT NULL"
    ).fetchone()[0]


def fetch_images(limit=80, sleep=0.3, progress=None):
    """Fill image_url for attractions that have a Wikipedia/Wikidata source."""
    db.init_db()
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT id, info_sources FROM attractions "
        "WHERE image_checked_at IS NULL AND info_sources NOT IN ('', '[]') "
        "AND info_sources IS NOT NULL ORDER BY COALESCE(family_score,0) DESC LIMIT ?",
        (limit,),
    ).fetchall()

    found = 0
    for i, r in enumerate(rows, 1):
        img = None
        try:
            img = find_image(r["info_sources"])
        except Exception:
            pass
        conn.execute(
            "UPDATE attractions SET image_url=?, image_checked_at=datetime('now') WHERE id=?",
            (img, r["id"]),
        )
        if img:
            found += 1
        conn.commit()
        if progress:
            progress(i, len(rows))
        if sleep:
            time.sleep(sleep)
    conn.close()
    return {"checked": len(rows), "found": found}


if __name__ == "__main__":
    print(fetch_images(limit=120))
