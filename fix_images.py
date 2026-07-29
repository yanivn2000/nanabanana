"""Replace logo / SVG attraction images with a real photo.

The base image pipeline stored the Wikipedia *summary* image, which for org/venue
articles (museums, studios) is the LOGO, not a photo — weak in the editorial
photo-forward cards. This pass finds those and swaps in the real photo:

  logo/SVG image  ->  Wikidata P18 (via the article's wikibase_item)  ->  Commons thumb

P18 is the entity's representative image (usually a landscape building shot). We also
backfill the Wikidata source into info_sources so future runs have it.

  --city <substr>   limit to one destination
  --must-see        only must_see=1 rows
  --limit N         cap rows
  --test            print what WOULD change, no writes
  --apply           write
"""
import sys, urllib.parse
import requests
import psycopg2.extras
import db

H = {"User-Agent": "NanaBanana/0.1 (trip planner; yaniv@eos-online.com)"}
WIDTH = 800  # crisp enough for the large editorial frames + retina
BAD = ("logo", "seal", "icon", "wordmark", "emblem", "coat_of_arms", "crest", ".svg")

APPLY = "--apply" in sys.argv
TEST = "--test" in sys.argv
CITY = sys.argv[sys.argv.index("--city") + 1] if "--city" in sys.argv else None
MUST = "--must-see" in sys.argv
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None


def is_bad(url):
    fn = (url or "").split("/")[-1].split("?")[0].lower()
    return any(w in fn for w in BAD)


def wp_to_qid(lang, title):
    try:
        r = requests.get(f"https://{lang}.wikipedia.org/w/api.php", headers=H, timeout=20, params={
            "action": "query", "prop": "pageprops", "titles": title, "redirects": 1, "format": "json"})
        for _, p in r.json().get("query", {}).get("pages", {}).items():
            return (p.get("pageprops") or {}).get("wikibase_item")
    except Exception:
        return None


def p18_file(qid):
    try:
        cl = requests.get(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json",
                          headers=H, timeout=20).json()["entities"][qid]["claims"]
        return cl["P18"][0]["mainsnak"]["datavalue"]["value"]
    except (KeyError, IndexError, Exception):
        return None


def commons_thumb(filename):
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(filename.replace(' ', '_'))}?width={WIDTH}"


def load(conn):
    where = ["a.image_url IS NOT NULL",
             "(a.image_url ILIKE '%%logo%%' OR a.image_url ILIKE '%%.svg%%' OR a.image_url ILIKE '%%seal%%' OR a.image_url ILIKE '%%emblem%%' OR a.image_url ILIKE '%%coat_of_arms%%')",
             "(a.is_duplicate IS NULL OR a.is_duplicate=0)"]
    params = []
    if MUST:
        where.append("a.must_see=1")
    if CITY:
        where.append("(d.city ILIKE %s OR d.city_he ILIKE %s)"); params += [f"%{CITY}%", f"%{CITY}%"]
    sql = (f"SELECT a.id,a.name_en,a.info_sources,a.image_url,d.city FROM attractions a "
           f"JOIN destinations d ON d.id=a.destination_id WHERE {' AND '.join(where)} ORDER BY d.id,a.name_en")
    rows = conn.execute(sql, tuple(params)).fetchall()
    return rows[:LIMIT] if LIMIT else rows


def qid_for(row):
    srcs = db.jloads(row["info_sources"]) or []
    for s in srcs:
        if s.get("title") == "Wikidata":
            return s["url"].rstrip("/").split("/")[-1], srcs
    for s in srcs:
        if s.get("title") == "Wikipedia":
            try:
                p = urllib.parse.urlparse(s["url"]); lang = p.netloc.split(".")[0]
                title = urllib.parse.unquote(p.path.split("/wiki/", 1)[1])
            except Exception:
                continue
            q = wp_to_qid(lang, title)
            if q:
                return q, srcs
    return None, srcs


def main():
    conn = db.get_conn()
    rows = load(conn)
    print(f"logo/svg images to fix: {len(rows)}  city={CITY} must_see={MUST} apply={APPLY} test={TEST}", flush=True)
    fixed = skip = 0
    for i, r in enumerate(rows, 1):
        qid, srcs = qid_for(r)
        fn = p18_file(qid) if qid else None
        if not fn or is_bad(fn):
            skip += 1
            if TEST:
                print(f"  SKIP {r['name_en'][:32]:32} (qid={qid} P18={fn})")
            continue
        newurl = commons_thumb(fn)
        # add Wikidata to info_sources if it wasn't there
        if not any(s.get("title") == "Wikidata" for s in srcs):
            srcs = srcs + [{"title": "Wikidata", "url": f"https://www.wikidata.org/wiki/{qid}"}]
        fixed += 1
        if TEST:
            print(f"  FIX  {r['city'][:10]:10} {r['name_en'][:30]:30} -> {fn[:44]}")
        if APPLY:
            for attempt in (1, 2, 3):
                try:
                    conn.execute("UPDATE attractions SET image_url=%s, info_sources=%s, image_checked_at=now() WHERE id=%s",
                                 (newurl, psycopg2.extras.Json(srcs), r["id"]))
                    break
                except Exception as e:
                    print(f"  DB-retry {r['id']} ({attempt}): {e}", flush=True)
                    try: conn.close()
                    except Exception: pass
                    conn = db.get_conn()
        if not TEST and i % 20 == 0:
            print(f"  {i}/{len(rows)} — fixed={fixed} skip={skip}", flush=True)
    if APPLY:
        conn.commit()
    print(f"DONE — fixed={fixed} skipped={skip}", flush=True)


if __name__ == "__main__":
    main()
