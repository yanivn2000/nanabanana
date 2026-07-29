"""Phase 2 — Claude translates a must-see's source-language Wikipedia LEAD into a
Hebrew paragraph, for must-sees that HAVE an English/local Wikipedia article but NO
Hebrew one (the ~510 the grounded Hebrew pull can't reach).

GROUNDED: Claude translates the provided extract faithfully — no added facts, no
opinion. Encyclopedic tone, one paragraph. Uses claude-opus-5 with structured output
(json_schema) so the response is always a clean {"he": "..."} — thinking disabled
(pure translation, the schema enforces the shape), same rationale as enrich.py.

  --city <substr>  limit to one destination (city / city_he)
  --limit N        cap the number processed
  --test           preview first 8, print translations, no writes
  --apply          write
"""
import sys, os, re, json, urllib.parse
sys.path.insert(0, "/Users/yanivnuriel/Documents/GitHub/AI/nanabanana")
import requests, db, psycopg2.extras
import anthropic
import enrich_grounded as eg   # reuse resolve / _para / first_sentence / H / LANG

APPLY = "--apply" in sys.argv
TEST = "--test" in sys.argv
CITY = sys.argv[sys.argv.index("--city")+1] if "--city" in sys.argv else None
LIMIT = int(sys.argv[sys.argv.index("--limit")+1]) if "--limit" in sys.argv else None
MODEL = "claude-opus-5"

def get_key():
    k = os.environ.get("ANTHROPIC_API_KEY")
    if k:
        return k
    for path in ("~/.nanabanana-web.env",
                 "/Users/yanivnuriel/Documents/GitHub/AI/nanabanana/web/.env.local"):
        try:
            for line in open(os.path.expanduser(path)):
                if line.strip().startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    return None

def _intro(lang, title):
    """Full lead section (plain text) for ANY language via TextExtracts exintro."""
    try:
        r = requests.get(f"https://{lang}.wikipedia.org/w/api.php", headers=eg.H, timeout=20, params={
            "action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1, "redirects": 1,
            "titles": title, "format": "json"})
        for _, p in r.json().get("query", {}).get("pages", {}).items():
            ex = (p.get("extract") or "").strip()
            if len(ex) >= 40:
                return ex
    except Exception:
        pass
    return None

def wikidata_article(qid, country):
    """Given a Wikidata Q-id, pick the best-language Wikipedia article from its
    sitelinks: local country language first, then English, then major langs, then any."""
    try:
        r = requests.get("https://www.wikidata.org/w/api.php", headers=eg.H, timeout=20, params={
            "action": "wbgetentities", "ids": qid, "props": "sitelinks", "format": "json"})
        links = r.json().get("entities", {}).get(qid, {}).get("sitelinks", {})
    except Exception:
        return None
    local = eg.LANG.get(country, "en")
    others = sorted(k[:-4] for k in links if k.endswith("wiki") and len(k) <= 7)  # e.g. "enwiki"→"en"
    seen = set()
    for lang in [local, "en", "de", "fr", "it", "es", "ru", "pt", "nl"] + others:
        if lang in seen or len(lang) > 3:
            continue
        seen.add(lang)
        sl = links.get(f"{lang}wiki")
        if sl and sl.get("title"):
            return lang, sl["title"]
    return None

def source_intro(r):
    """(lang, title, intro, url) — prefer a stored Wikipedia link; else resolve a
    Wikidata id to its best-language article; else re-resolve by name + coords."""
    srcs = db.jloads(r["info_sources"]) or []
    for s in srcs:
        if s.get("title") == "Wikipedia":
            try:
                p = urllib.parse.urlparse(s["url"]); lang = p.netloc.split(".")[0]
                title = urllib.parse.unquote(p.path.split("/wiki/", 1)[1])
            except Exception:
                continue
            ix = _intro(lang, title)
            if ix:
                return lang, title, ix, s["url"]
    # Wikidata id → its best-language Wikipedia article
    for s in srcs:
        if s.get("title") == "Wikidata":
            qid = s["url"].rstrip("/").split("/")[-1]
            art = wikidata_article(qid, r["country"])
            if art:
                lang, title = art
                ix = _intro(lang, title)
                if ix:
                    return lang, title, ix, f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
    local = eg.LANG.get(r["country"], "en")
    langs = ("en",) if local == "en" else ("en", local)
    hit = eg.resolve([r["name_en"], r["name_he"]], r["lat"], r["lng"], langs)
    if hit:
        lang, title, _ex, url = hit
        ix = _intro(lang, title)
        if ix:
            return lang, title, ix, url
    return None

SCHEMA = {"type": "object", "properties": {"he": {"type": "string"}},
          "required": ["he"], "additionalProperties": False}
SYSTEM = (
    "אתה מתרגם קטעי פתיחה של ויקיפדיה לעברית עבור אפליקציית טיולים. "
    "תרגם את הקטע לעברית בפסקה אחת, טון אנציקלופדי מדויק וזורם. "
    "כללים: אל תוסיף עובדות, דעות או פרשנות שאינן במקור; אל תשמיט עובדות מהותיות; "
    "אל תכלול כותרות, תגיות, הערות או הקדמות; השאר שמות לועזיים בסוגריים כשזה עוזר להבנה. "
    'החזר אך ורק JSON בצורה {"he": "<הפסקה בעברית>"}.'
)

def translate(client, name, intro):
    resp = client.messages.create(
        model=MODEL, max_tokens=1500, system=SYSTEM,
        thinking={"type": "disabled"},
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": f"שם המקום: {name}\n\nקטע הפתיחה מוויקיפדיה:\n{intro[:2600]}"}],
    )
    if resp.stop_reason == "refusal":
        return None
    txt = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        he = (json.loads(txt).get("he") or "").strip()
    except Exception:
        he = ""
    return he or None

def load(conn):
    where = ["a.must_see=1", "(a.description_he IS NULL OR a.description_he='')", "a.lat IS NOT NULL",
             "a.info_sources IS NOT NULL", "a.info_sources::text NOT IN ('[]','null')",
             "(a.is_duplicate IS NULL OR a.is_duplicate=0)"]
    params = []
    if CITY:
        where.append("(d.city ILIKE %s OR d.city_he ILIKE %s)"); params += [f"%{CITY}%", f"%{CITY}%"]
    sql = (f"SELECT a.id,a.name_he,a.name_en,a.lat,a.lng,d.country,a.info_sources "
           f"FROM attractions a JOIN destinations d ON d.id=a.destination_id "
           f"WHERE {' AND '.join(where)} ORDER BY d.id")
    return conn.execute(sql, tuple(params)).fetchall()

def main():
    key = get_key()
    if not key:
        print("STOPPED: no ANTHROPIC_API_KEY", flush=True); return
    client = anthropic.Anthropic(api_key=key)
    conn = db.get_conn()
    rows = load(conn)
    if LIMIT:
        rows = rows[:LIMIT]
    if TEST:
        rows = rows[:8]
    print(f"rows={len(rows)} apply={APPLY} test={TEST} model={MODEL}", flush=True)
    ok = nosrc = fail = 0
    for i, r in enumerate(rows, 1):
        si = source_intro(r)
        if not si:
            nosrc += 1
            if TEST:
                print(f"  NO-SRC  {r['name_he'] or r['name_en']}")
            continue
        lang, title, intro, url = si
        try:
            he = translate(client, r["name_he"] or r["name_en"], intro)
        except Exception as e:
            fail += 1
            print(f"  ERR {r['id']} {r['name_en']}: {e}", flush=True)
            continue
        if not he:
            fail += 1
            continue
        he = eg._para(he)
        tag = eg.first_sentence(he)
        ok += 1
        if TEST:
            print(f"  HE  {r['name_he'] or r['name_en']}  <- {lang}:{title}\n      {he[:220]}")
        if APPLY:
            # Supabase drops the connection while it sits idle during the ~10s API call —
            # reconnect and retry the write so one drop doesn't abort the whole run.
            for attempt in (1, 2, 3):
                try:
                    conn.execute(
                        "UPDATE attractions SET description_he=%s, tagline_he=COALESCE(NULLIF(tagline_he,''),%s), "
                        "info_sources=%s WHERE id=%s",
                        (he, tag, psycopg2.extras.Json([{"title": "Wikipedia", "url": url}]), r["id"]))
                    break
                except Exception as e:
                    print(f"  DB-retry {r['id']} (attempt {attempt}): {e}", flush=True)
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = db.get_conn()
        if not TEST and i % 25 == 0:
            print(f"  {i}/{len(rows)} — ok={ok} nosrc={nosrc} fail={fail}", flush=True)
    if APPLY:
        conn.commit()
    print(f"DONE — translated={ok} no_source={nosrc} failed={fail}", flush=True)

if __name__ == "__main__":
    main()
