"""City-scoped curation pass — runs the enrich.py editor over ONE city's
un-enriched rows, highest-value first (photo, then wiki, then rough score), so a
freshly-ingested city (e.g. New York) gets quality_keep / must_see / tagline /
cost properly assigned instead of sitting at NULL.

Reuses enrich.py's SYSTEM prompt + schema + write-back; only the row selection is
city-scoped and the model is pinned to claude-opus-5 with thinking disabled
(structured extraction — the schema enforces the shape; per the project's
"don't downgrade the model for cost" rule).

  --city <substr>     required — city / city_he match
  --limit N           cap rows this run (default 60)
  --notable-only      only rows with a Wikipedia/Wikidata source
  --test              run ONE batch, print results, no writes
  --apply             write back
"""
import sys, os, json
import anthropic
import db
import enrich as E   # reuse SYSTEM, OUTPUT_SCHEMA, _build_prompt, BATCH_SIZE

MODEL = "claude-opus-5"
CITY = sys.argv[sys.argv.index("--city") + 1] if "--city" in sys.argv else None
CATEGORY = sys.argv[sys.argv.index("--category") + 1] if "--category" in sys.argv else None
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 60
NOTABLE = "--notable-only" in sys.argv
TEST = "--test" in sys.argv
APPLY = "--apply" in sys.argv


def get_key():
    k = os.environ.get("ANTHROPIC_API_KEY")
    if k:
        return k
    for path in ("/Users/yanivnuriel/Documents/GitHub/AI/nanabanana/web/.env.local",):
        try:
            for line in open(os.path.expanduser(path)):
                if line.strip().startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    return None


def select_rows(conn):
    where = ["a.enriched_at IS NULL", "(a.is_duplicate IS NULL OR a.is_duplicate=0)"]
    params = []
    if CITY:
        where.append("(d.city ILIKE %s OR d.city_he ILIKE %s)")
        params += [f"%{CITY}%", f"%{CITY}%"]
    if CATEGORY:
        where.append("a.category = %s")
        params.append(CATEGORY)
    if NOTABLE:
        where.append("a.info_sources IS NOT NULL AND a.info_sources::text NOT IN ('[]','null')")
    sql = (f"SELECT a.id, a.name_en, a.category, a.subcategory, a.website "
           f"FROM attractions a JOIN destinations d ON d.id=a.destination_id "
           f"WHERE {' AND '.join(where)} "
           f"ORDER BY (a.image_url IS NOT NULL) DESC, "
           f"(a.info_sources IS NOT NULL AND a.info_sources::text NOT IN ('[]','null')) DESC, "
           f"COALESCE(a.family_score,0) DESC LIMIT {LIMIT}")
    return conn.execute(sql, tuple(params)).fetchall()


def enrich_batch(conn, client, rows):
    resp = client.messages.create(
        model=MODEL, max_tokens=16000, system=E.SYSTEM,
        thinking={"type": "disabled"},
        output_config={"format": {"type": "json_schema", "schema": E.OUTPUT_SCHEMA}},
        messages=[{"role": "user", "content": E._build_prompt(rows)}],
    )
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise ValueError(f"no text (stop={resp.stop_reason})")
    items = json.loads(text)["items"]
    if TEST:
        for it in items:
            print(f"  keep={int(it['quality_keep'])} must={int(it['must_see'])} f{it['family_score']} "
                  f"| {it['name_he']}  — {it.get('tagline_he','')}")
        return 0
    n = 0
    for it in items:
        # Supabase can drop an idle connection during the API call — retry the write.
        for attempt in (1, 2, 3):
            try:
                conn.execute(
                    "UPDATE attractions SET name_he=%s, family_score=%s, min_age=%s, max_age=%s, "
                    "indoor_outdoor=%s, quality_keep=%s, tips_he=%s, tagline_he=%s, best_season=%s, "
                    "best_time_he=%s, dress_he=%s, cost_level=%s, must_see=%s, enriched_at=now() WHERE id=%s",
                    (it["name_he"], it["family_score"], it["min_age"], it["max_age"], it["indoor_outdoor"],
                     1 if it["quality_keep"] else 0, it["tips_he"], it.get("tagline_he"), it.get("best_season"),
                     it.get("best_time_he"), it.get("dress_he"), it.get("cost_level"),
                     1 if it.get("must_see") else 0, it["id"]))
                break
            except Exception as e:
                print(f"  DB-retry {it['id']} (attempt {attempt}): {e}", flush=True)
                try: conn.close()
                except Exception: pass
                conn = db.get_conn()
        n += 1
    conn.commit()
    return n, conn


def main():
    if not CITY and not CATEGORY:
        print("STOPPED: --city or --category required", flush=True); return
    key = get_key()
    if not key:
        print("STOPPED: no ANTHROPIC_API_KEY", flush=True); return
    client = anthropic.Anthropic(api_key=key)
    conn = db.get_conn()
    rows = select_rows(conn)
    if TEST:
        rows = rows[:E.BATCH_SIZE]
    print(f"city={CITY} rows={len(rows)} model={MODEL} notable_only={NOTABLE} apply={APPLY} test={TEST}", flush=True)
    done = 0
    for i in range(0, len(rows), E.BATCH_SIZE):
        batch = rows[i:i + E.BATCH_SIZE]
        try:
            r = enrich_batch(conn, client, batch)
            if isinstance(r, tuple):
                d, conn = r; done += d
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            print(f"  skip batch ({len(batch)}): {e}", flush=True)
        if not TEST and (i // E.BATCH_SIZE) % 3 == 0:
            print(f"  {done}/{len(rows)}", flush=True)
    print(f"DONE — enriched={done}", flush=True)


if __name__ == "__main__":
    main()
