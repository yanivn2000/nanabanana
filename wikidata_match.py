"""Smarter must-see enrichment via Wikidata GEOSEARCH (name-variant tolerant).

enrich_grounded matched by Wikipedia title, which fails on Hebrew name variants
("ארמון ואוול" vs the article "Wawel Castle"). This instead finds Wikidata entities
NEAR the attraction's coordinates, picks the one whose label best matches the name,
and pulls its P18 image + Hebrew-Wikipedia lead. Fills only EMPTY fields.

  --test         dry-run, print matches (no writes)
  --apply        write
  --limit N      cap rows
  --min-sim F    name-similarity floor (default 0.55)
Scope: effective must-see (editor rank or OSM) missing an image OR a description.
"""
import sys, time, urllib.parse, requests
import db
from enrich_grounded import H, _norm, _sim, _he_intro_text, _para, first_sentence

APPLY = "--apply" in sys.argv
LIMIT = int(sys.argv[sys.argv.index("--limit")+1]) if "--limit" in sys.argv else None
MIN_SIM = float(sys.argv[sys.argv.index("--min-sim")+1]) if "--min-sim" in sys.argv else 0.55
WIDTH = 800

def geosearch(lat, lng, radius=600, limit=20):
    r = requests.get("https://www.wikidata.org/w/api.php", headers=H, timeout=20, params={
        "action": "query", "list": "geosearch", "gscoord": f"{lat}|{lng}",
        "gsradius": radius, "gslimit": limit, "format": "json"})
    return [g["title"] for g in r.json().get("query", {}).get("geosearch", [])]

def entities(qids):
    if not qids: return {}
    r = requests.get("https://www.wikidata.org/w/api.php", headers=H, timeout=25, params={
        "action": "wbgetentities", "ids": "|".join(qids),
        "props": "labels|claims|sitelinks", "languages": "en|he",
        "sitefilter": "hewiki", "format": "json"})
    return r.json().get("entities", {})

def best_match(names, ent_map):
    want = [_norm(n) for n in names if n]
    best, best_s = None, 0.0
    for qid, e in ent_map.items():
        labs = [e.get("labels", {}).get(l, {}).get("value", "") for l in ("en", "he")]
        for lab in labs:
            if not lab: continue
            s = max((_sim(w, _norm(lab)) for w in want), default=0)
            if s > best_s:
                best_s, best = s, (qid, e)
    return best, best_s

def commons_thumb(filename):
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(filename.replace(' ','_'))}?width={WIDTH}"

def main():
    conn = db.get_conn()
    rows = conn.execute("""
      SELECT a.id, a.name_he, a.name_en, a.lat, a.lng, a.image_url, a.description_he, a.tagline_he
      FROM attractions a
      LEFT JOIN editor_picks ep ON ep.attraction_id=a.id AND ep.destination_id=a.destination_id
      JOIN destinations d ON d.id=a.destination_id
      WHERE (CASE WHEN ep.rank IS NOT NULL THEN (ep.rank='must')::int ELSE a.must_see END)=1
        AND (a.is_duplicate IS NULL OR a.is_duplicate=0) AND a.lat IS NOT NULL
        AND ((a.image_url IS NULL OR a.image_url='') OR char_length(COALESCE(a.description_he,''))<80)
      ORDER BY d.id""").fetchall()
    if LIMIT: rows = rows[:LIMIT]
    print(f"candidates={len(rows)} apply={APPLY} min_sim={MIN_SIM}", flush=True)
    img_n = desc_n = miss = 0
    for i, r in enumerate(rows, 1):
        try:
            qids = geosearch(r["lat"], r["lng"])
            ent = entities(qids)
            match, sim = best_match([r["name_en"], r["name_he"]], ent)
        except Exception as e:
            match, sim = None, 0
        name = r["name_he"] or r["name_en"]
        if not match or sim < MIN_SIM:
            miss += 1
            if not APPLY: print(f"  --  {name}  (no confident match, best={sim:.2f})")
            time.sleep(0.3); continue
        qid, e = match
        # image (only if missing)
        new_img = None
        if not (r["image_url"] and r["image_url"].strip()):
            p18 = e.get("claims", {}).get("P18")
            if p18:
                try: new_img = commons_thumb(p18[0]["mainsnak"]["datavalue"]["value"])
                except Exception: pass
        # hebrew description (only if thin)
        new_desc = new_tag = None
        if len(r["description_he"] or "") < 80:
            ht = e.get("sitelinks", {}).get("hewiki", {}).get("title")
            if ht:
                try:
                    txt = _he_intro_text(ht)
                    if txt: new_desc = _para(txt); new_tag = first_sentence(txt)
                except Exception: pass
        if not new_img and not new_desc:
            miss += 1
            if not APPLY: print(f"  ~  {name} -> {qid} (sim {sim:.2f}) but no P18/He")
            time.sleep(0.3); continue
        if not APPLY:
            print(f"  OK {name} -> {qid} (sim {sim:.2f})  img={'Y' if new_img else '-'} desc={'Y' if new_desc else '-'}")
            if new_desc: print(f"        {new_tag}")
        if APPLY:
            if new_img: conn.execute("UPDATE attractions SET image_url=?, image_checked_at=datetime('now') WHERE id=?", (new_img, r["id"]))
            if new_desc: conn.execute("UPDATE attractions SET description_he=?, tagline_he=COALESCE(NULLIF(tagline_he,''),?) WHERE id=?", (new_desc, new_tag, r["id"]))
            conn.commit()
        if new_img: img_n += 1
        if new_desc: desc_n += 1
        if not APPLY and (new_img or new_desc): pass
        if i % 25 == 0: print(f"  {i}/{len(rows)} img+={img_n} desc+={desc_n} miss={miss}", flush=True)
        time.sleep(0.35)
    print(f"DONE — images+={img_n} descriptions+={desc_n} unmatched={miss}", flush=True)

main()
