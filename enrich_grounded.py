"""Grounded Hebrew enrichment from Wikipedia (no hand-writing = no hallucination).

Per attraction:
  1. Find the COORDINATE-verified Wikipedia article (en/local, which carries
     coords) -> the correct entity (no homonyms).
  2. Follow that article's Wikidata link to its HEBREW article -> native Hebrew
     extract -> description_he + tagline_he (grounded, accurate, correct entity).
  3. Article exists but no Hebrew sitelink: it still HAS a story -> backfill
     info_sources (keep it), no Hebrew text yet.
  4. No article at all (set=kept only): no encyclopedic story -> hide
     (quality_keep=0), per the "if shown, it must have a reason" principle.

  --set kept    the ~1,923 kept-no-story (hide if not found)
  --set mustsee must-see missing a description (never hidden)
  --test        preview first 12, print extracts, no writes
  --apply       write
"""
import sys, re, urllib.parse
sys.path.insert(0, "/Users/yanivnuriel/Documents/GitHub/AI/nanabanana")
import requests, db, psycopg2.extras
from math import radians, sin, cos, atan2, sqrt
import difflib

APPLY = "--apply" in sys.argv
TEST = "--test" in sys.argv
SET = sys.argv[sys.argv.index("--set")+1] if "--set" in sys.argv else "kept"
H = {"User-Agent": "NanaBanana/0.1 (yaniv@eos-online.com)"}
LANG = {"Austria":"de","Germany":"de","Switzerland":"de","Greece":"el","Cyprus":"el",
        "Hungary":"hu","Czechia":"cs","Spain":"es","Netherlands":"nl","France":"fr",
        "Portugal":"pt","Italy":"it","Israel":"he","Georgia":"ka","United Kingdom":"en"}

def _norm(s):
    s=(s or "").lower(); s=re.sub(r"\(.*?\)"," ",s)
    return re.sub(r"\s+"," ",re.sub(r"[^a-z0-9֐-׿Ͱ-Ͽ ]"," ",s)).strip()
def _sim(a,b):
    a,b=_norm(a),_norm(b)
    if not a or not b: return 0
    if a in b or b in a: return 0.9
    return difflib.SequenceMatcher(None,a,b).ratio()
def _hav(a,b,c,d):
    R=6371000;p1,p2=radians(a),radians(c);dp=radians(c-a);dl=radians(d-b)
    x=sin(dp/2)**2+cos(p1)*cos(p2)*sin(dl/2)**2;return R*2*atan2(sqrt(x),sqrt(1-x))
def _summary(lang,title):
    try:
        r=requests.get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title)}",headers=H,timeout=20)
        return r.json() if r.status_code==200 else None
    except Exception: return None
def _search(lang,name):
    try:
        r=requests.get(f"https://{lang}.wikipedia.org/w/api.php",headers=H,timeout=20,params={
            "action":"opensearch","search":name[:100],"limit":5,"format":"json"})
        return r.json()[1] if r.status_code==200 else []
    except Exception: return []

def _qid(lang, title):
    try:
        r=requests.get(f"https://{lang}.wikipedia.org/w/api.php",headers=H,timeout=20,params={
            "action":"query","prop":"pageprops","ppprop":"wikibase_item","titles":title,
            "redirects":1,"format":"json"})
        for _,p in r.json().get("query",{}).get("pages",{}).items():
            q=(p.get("pageprops") or {}).get("wikibase_item")
            if q: return q
    except Exception: pass
    return None

def _he_title(qid):
    try:
        r=requests.get("https://www.wikidata.org/w/api.php",headers=H,timeout=20,params={
            "action":"wbgetentities","ids":qid,"props":"sitelinks","sitefilter":"hewiki","format":"json"})
        return r.json()["entities"][qid]["sitelinks"]["hewiki"]["title"]
    except Exception:
        return None

def resolve(names, lat, lng, langs):
    """Coordinate-verified article (correct entity). Returns (lang,title,extract,url)."""
    for lang in langs:
        for name in names:
            if not name: continue
            for t in _search(lang, name):
                d=_summary(lang,t)
                if not d: continue
                ex=(d.get("extract") or "").strip(); co=d.get("coordinates")
                if len(ex)<25 or not co: continue
                title=d.get("title") or t
                if _hav(lat,lng,co["lat"],co["lon"])<=3000 and _sim(name,title)>=0.5:
                    url=f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ','_'))}"
                    return lang, title, ex, url
    return None

def hebrew_for(lang, title):
    """Follow the article's Wikidata link to its Hebrew article -> (he_extract, he_url)."""
    q=_qid(lang,title)
    if not q: return None
    ht=_he_title(q)
    if not ht: return None
    d=_summary("he",ht)
    ex=(d or {}).get("extract","").strip()
    if len(ex)<25: return None
    return ex, f"https://he.wikipedia.org/wiki/{urllib.parse.quote(ht.replace(' ','_'))}"

def first_sentence(text, maxlen=100):
    s=re.split(r"(?<=[.!?。])\s", text.strip())[0]
    if len(s)<=maxlen: return s.rstrip(" ,;:—-")
    cut=s[:maxlen].rsplit(" ",1)[0]
    return cut.rstrip(" ,;:—-")+"…"

FILLER="'gallery','dog_park','garden','park','parklet','attraction','information','sports_centre','trampoline_park','artwork','yes'"

def load(conn):
    if SET=="kept":
        return conn.execute(f"""SELECT a.id,a.name_he,a.name_en,a.lat,a.lng,d.country
          FROM attractions a JOIN destinations d ON d.id=a.destination_id
          WHERE (a.quality_keep=1 OR a.quality_keep IS NULL) AND (a.is_duplicate IS NULL OR a.is_duplicate=0)
            AND (a.is_component IS NULL OR a.is_component=0)
            AND (a.info_sources IS NULL OR a.info_sources::text IN ('[]','null'))
            AND (a.must_see IS NULL OR a.must_see=0)
            AND (a.tagline_he IS NULL OR a.tagline_he='') AND (a.description_he IS NULL OR a.description_he='')
            AND a.subcategory NOT IN ({FILLER}) AND a.lat IS NOT NULL ORDER BY d.id""").fetchall()
    return conn.execute("""SELECT a.id,a.name_he,a.name_en,a.lat,a.lng,d.country
      FROM attractions a JOIN destinations d ON d.id=a.destination_id
      WHERE a.must_see=1 AND (a.is_duplicate IS NULL OR a.is_duplicate=0)
        AND (a.description_he IS NULL OR a.description_he='') AND a.lat IS NOT NULL ORDER BY d.id""").fetchall()

def main():
    conn=db.get_conn()
    rows=load(conn)
    if TEST: rows=rows[:12]
    print(f"set={SET} rows={len(rows)} apply={APPLY} test={TEST}", flush=True)
    he_n=story_n=hide_n=0
    for i,r in enumerate(rows,1):
        local=LANG.get(r["country"],"en")
        langs=("en",) if local=="en" else ("en",local)
        hit=resolve([r["name_en"],r["name_he"]], r["lat"], r["lng"], langs)  # correct entity
        if hit:
            lang,title,ex,url=hit
            he=hebrew_for(lang,title)   # follow Wikidata -> Hebrew article
            if he:
                hex,heurl=he; desc=hex[:400].rstrip(); tag=first_sentence(hex); he_n+=1
                if TEST: print(f"  HE  {r['name_he'] or r['name_en']} -> {title}\n      tag: {tag}\n      desc: {desc[:180]}")
                if APPLY:
                    conn.execute("""UPDATE attractions SET description_he=%s,
                        tagline_he=COALESCE(NULLIF(tagline_he,''),%s), info_sources=%s WHERE id=%s""",
                        (desc, tag, psycopg2.extras.Json([{"title":"Wikipedia","url":heurl}]), r["id"]))
            else:
                story_n+=1
                if TEST: print(f"  ST  {r['name_he'] or r['name_en']} -> {title} (no He article)")
                if APPLY:
                    conn.execute("UPDATE attractions SET info_sources=%s WHERE id=%s",
                                 (psycopg2.extras.Json([{"title":"Wikipedia","url":url}]), r["id"]))
        elif SET=="kept":
            hide_n+=1
            if TEST: print(f"  --  {r['name_he'] or r['name_en']} (no article -> hide)")
            if APPLY:
                conn.execute("UPDATE attractions SET quality_keep=0 WHERE id=%s",(r["id"],))
        if APPLY and i%50==0: conn.commit()
        if not TEST and i%100==0: print(f"  {i}/{len(rows)} — he={he_n} story={story_n} hide={hide_n}", flush=True)
    if APPLY: conn.commit()
    print(f"DONE — hebrew_desc={he_n}  story_only={story_n}  hidden={hide_n}", flush=True)

if __name__=="__main__":
    main()
