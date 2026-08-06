"""Resilient recovery for the El Al city batch: re-run the Hebrew enrichment
passes that died on dropped connections, retrying until a clean full pass.
Idempotent — each pass only touches still-empty rows (commits every 50), so
restarts make forward progress. Then hide no-story junk + print coverage.
"""
import sys, subprocess, time
from pathlib import Path
ROOT = str(Path(__file__).resolve().parent)   # the repo, wherever it is cloned
sys.path.insert(0, ROOT)
import db


def run_until_clean(label, args, max_tries=50):
    for i in range(1, max_tries + 1):
        print(f"=== {label} · attempt {i} ===", flush=True)
        p = subprocess.run([sys.executable] + args, cwd=ROOT)
        if p.returncode == 0:
            print(f"{label}: CLEAN after {i} attempt(s)", flush=True)
            return True
        print(f"{label}: exit={p.returncode} — retrying in 4s", flush=True)
        time.sleep(4)
    print(f"{label}: GAVE UP after {max_tries}", flush=True)
    return False


run_until_clean("hebrew-descriptions", ["enrich_grounded.py", "--set", "notable", "--apply"])
run_until_clean("hebrew-names", ["fill_names.py", "--apply"])

# Hide no-story junk in the batch being recovered. SINCE defaults to the El Al
# batch this was written for — pass --since-id to point it at a later one.
SINCE = int(sys.argv[sys.argv.index("--since-id") + 1]) if "--since-id" in sys.argv else 34
conn = db.get_conn()
conn.execute(
    "UPDATE attractions SET quality_keep=0 WHERE destination_id >= %s "
    "  AND (must_see IS DISTINCT FROM 1) "
    "  AND (description_he IS NULL OR description_he='') "
    "  AND (image_url IS NULL OR image_url='') "
    "  AND (info_sources IS NULL OR info_sources::text IN ('[]','null'))", (SINCE,)
)
conn.close()
print("hid no-story junk", flush=True)

conn = db.get_conn()
r = conn.execute(
    "SELECT count(*) tot, "
    "  count(*) FILTER (WHERE description_he IS NOT NULL AND description_he<>'') deshe, "
    "  count(*) FILTER (WHERE name_he IS NOT NULL AND name_he<>'') namehe, "
    "  count(*) FILTER (WHERE image_url IS NOT NULL AND image_url<>'') img, "
    "  count(*) FILTER (WHERE quality_keep=1 OR quality_keep IS NULL) shown "
    "FROM attractions WHERE destination_id >= %s", (SINCE,)
).fetchone()
conn.close()
print("COVERAGE:", {k: r[k] for k in ("tot", "deshe", "namehe", "img", "shown")}, flush=True)
print("RECOVERY DONE", flush=True)
