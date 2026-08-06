"""Automatic first-pass must-see for cities that have none yet.

Per city, rank the notable, shown attractions and flag the top ~35 as must_see.
Signal (best first): has a real Hebrew description → family_score → rating volume
→ closeness to the city centre. Notability gate = has a Wikipedia/Wikidata source
(info_sources), so we never promote a bare unsourced POI. Heuristic, not London-
grade hand-curation — a launchable first tier, refine later.
"""
import sys
from pathlib import Path
ROOT = str(Path(__file__).resolve().parent)   # the repo, wherever it is cloned
sys.path.insert(0, ROOT)
import db

TOP = 35
# Which cities to process. Defaults to the El Al batch (ids 34+) that this was
# first written for; pass --since-id / --city when running it on a later batch.
SINCE = 34
only = None
for i, a in enumerate(sys.argv):
    if a == "--since-id" and i + 1 < len(sys.argv):
        SINCE = int(sys.argv[i + 1])
    if a == "--city" and i + 1 < len(sys.argv):
        only = int(sys.argv[i + 1])
if "--top" in sys.argv:
    TOP = int(sys.argv[sys.argv.index("--top") + 1])

conn = db.get_conn()
dests = [only] if only else [r["id"] for r in conn.execute(
    "SELECT id FROM destinations WHERE id >= %s ORDER BY id", (SINCE,)).fetchall()]
print(f"cities: {dests}  ·  top {TOP} per city")

total = 0
for d in dests:
    ctr = conn.execute("SELECT lat, lng, city FROM destinations WHERE id=%s", (d,)).fetchone()
    clat, clng, city = ctr["lat"], ctr["lng"], ctr["city"]
    rows = conn.execute(
        """
        SELECT id,
          (CASE WHEN description_he IS NOT NULL AND description_he<>'' THEN 1 ELSE 0 END) AS hasdesc,
          COALESCE(family_score,0) AS fam,
          COALESCE(rating_count,0) AS rc,
          ((lat-%s)*(lat-%s) + (lng-%s)*(lng-%s)*cos(radians(%s))*cos(radians(%s))) AS dist2
        FROM attractions
        WHERE destination_id=%s
          AND (quality_keep=1 OR quality_keep IS NULL)
          AND (is_duplicate IS NULL OR is_duplicate=0)
          AND (is_component IS NULL OR is_component=0)
          AND info_sources IS NOT NULL AND info_sources::text NOT IN ('[]','null')
          AND lat IS NOT NULL AND lng IS NOT NULL
        ORDER BY hasdesc DESC, fam DESC, rc DESC, dist2 ASC
        LIMIT %s
        """,
        (clat, clat, clng, clng, clat, clat, d, TOP),
    ).fetchall()
    ids = [r["id"] for r in rows]
    # Never pile heuristic must-sees on top of hand-curation. This is a FIRST
    # pass for a city that has none; a curated city (London, New York) must be
    # left alone unless someone explicitly asks for it.
    already = conn.execute(
        "SELECT count(*) AS n FROM attractions WHERE destination_id=%s AND must_see=1", (d,)
    ).fetchone()["n"]
    if already and "--force" not in sys.argv:
        print(f"dest {d:>3} {city:<16} -> דילוג, כבר יש {already} must-see (--force לדריסה)", flush=True)
        continue
    if ids:
        conn.execute("UPDATE attractions SET must_see=1 WHERE id = ANY(%s)", (ids,))
        total += len(ids)
    print(f"dest {d:>3} {city:<16} -> {len(ids)} must-see", flush=True)

conn.close()
print(f"TOTAL must-see set across new cities: {total}", flush=True)
print("MUSTSEE DONE", flush=True)
