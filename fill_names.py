"""Fill Hebrew names from Wikidata labels — grounded, no hand-writing.

For every SHOWN attraction that has a wiki source but no Hebrew name, resolve its
Wikidata QID (from the stored Wikidata link, or via the Wikipedia page's
wikibase_item) and set name_he to Wikidata's official Hebrew label. This is the
canonical Hebrew name of the entity, so it can never be a hallucination.

  --apply   write (otherwise a dry run that just reports the hit rate)
"""
import sys, time, urllib.parse
sys.path.insert(0, "/Users/yanivnuriel/Documents/GitHub/AI/nanabanana")
import requests, db

APPLY = "--apply" in sys.argv
H = {"User-Agent": "NanaBanana/0.1 (yaniv@eos-online.com)"}
SHOWN = ("(quality_keep=1 OR quality_keep IS NULL) AND (is_duplicate IS NULL OR is_duplicate=0) "
         "AND (is_component IS NULL OR is_component=0)")

def qid_from_sources(srcs):
    for s in srcs:                                   # a stored Wikidata id
        if s.get("title") == "Wikidata":
            return s["url"].rstrip("/").split("/")[-1]
    for s in srcs:                                   # else resolve via Wikipedia
        if s.get("title") == "Wikipedia":
            try:
                p = urllib.parse.urlparse(s["url"]); lang = p.netloc.split(".")[0]
                title = urllib.parse.unquote(p.path.split("/wiki/", 1)[1])
            except Exception:
                continue
            try:
                r = requests.get(f"https://{lang}.wikipedia.org/w/api.php", headers=H, timeout=20,
                    params={"action": "query", "prop": "pageprops", "ppprop": "wikibase_item",
                            "titles": title, "redirects": 1, "format": "json"})
                for _, pg in r.json().get("query", {}).get("pages", {}).items():
                    q = (pg.get("pageprops") or {}).get("wikibase_item")
                    if q:
                        return q
            except Exception:
                pass
    return None

def he_label(qid):
    try:
        r = requests.get("https://www.wikidata.org/w/api.php", headers=H, timeout=20,
            params={"action": "wbgetentities", "ids": qid, "props": "labels",
                    "languages": "he", "format": "json"})
        return r.json()["entities"][qid]["labels"]["he"]["value"]
    except Exception:
        return None

def main():
    conn = db.get_conn()
    rows = conn.execute(f"""SELECT id, name_en, info_sources FROM attractions a
        WHERE {SHOWN} AND (name_he IS NULL OR name_he='')
          AND info_sources IS NOT NULL AND info_sources::text NOT IN ('[]','null')
        ORDER BY COALESCE(family_score,0) DESC""").fetchall()
    print(f"candidates={len(rows)} apply={APPLY}", flush=True)
    n = miss = 0
    for i, r in enumerate(rows, 1):
        q = qid_from_sources(db.jloads(r["info_sources"]) or [])
        he = he_label(q) if q else None
        if he:
            n += 1
            if APPLY:
                conn.execute("UPDATE attractions SET name_he=%s WHERE id=%s", (he, r["id"]))
        else:
            miss += 1
        if APPLY and i % 50 == 0:
            conn.commit()
        if i % 100 == 0:
            print(f"  {i}/{len(rows)} he={n} miss={miss}", flush=True)
        time.sleep(0.2)
    if APPLY:
        conn.commit()
    print(f"DONE he_names={n} miss={miss}", flush=True)

if __name__ == "__main__":
    main()
