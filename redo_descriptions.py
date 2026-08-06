"""Re-run the grounded Hebrew-description pass until coverage stops growing.

Each pass only touches still-empty rows, so re-running is safe and additive. It
stops when the Hebrew-description count has not grown for two passes in a row —
the rows that remain are the permanent ones (an article exists but has no Hebrew
sitelink), and no number of retries will fill them.

Use it after a city batch, when a run finished but coverage looks low. A flaky
network is the usual cause: Wikipedia/Wikidata calls drop, every row falls back
to "story only", and the pass reports success having written nothing. Sibling
script: recover_enrich.py retries a pass that CRASHED; this one re-runs a pass
that completed but under-filled.
"""
import sys, subprocess, time
from pathlib import Path
ROOT = str(Path(__file__).resolve().parent)   # the repo, wherever it is cloned
sys.path.insert(0, ROOT)
import db


def desc_count():
    conn = db.get_conn()
    n = conn.execute(
        "SELECT count(*) FROM attractions WHERE destination_id>=34 "
        "AND description_he IS NOT NULL AND description_he<>''"
    ).fetchone()[0]
    conn.close()
    return n


stagnant = 0
prev = desc_count()
print(f"start: {prev} new-city descriptions", flush=True)
for i in range(1, 40):
    print(f"=== pass {i} (have {prev}) ===", flush=True)
    subprocess.run([sys.executable, "enrich_grounded.py", "--set", "notable", "--apply"], cwd=ROOT)
    now = desc_count()
    print(f"  -> {now} (+{now - prev})", flush=True)
    if now <= prev:
        stagnant += 1
        if stagnant >= 2:
            print("no progress for 2 passes — done", flush=True)
            break
    else:
        stagnant = 0
    prev = now
    time.sleep(3)

# final coverage
conn = db.get_conn()
r = conn.execute(
    "SELECT count(*) tot, "
    "  count(*) FILTER (WHERE description_he IS NOT NULL AND description_he<>'') deshe, "
    "  count(*) FILTER (WHERE name_he IS NOT NULL AND name_he<>'') namehe, "
    "  count(*) FILTER (WHERE quality_keep=1 OR quality_keep IS NULL) shown "
    "FROM attractions WHERE destination_id>=34"
).fetchone()
conn.close()
print("FINAL COVERAGE:", {k: r[k] for k in ("tot", "deshe", "namehe", "shown")}, flush=True)
print("DESC REDO DONE", flush=True)
