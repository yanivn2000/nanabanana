"""Continuous enrichment runner — launched in the background from the admin.

Enriches batches until nothing is pending or it hits an error (e.g. credit
runs out / rate limit), then stops cleanly. Re-run to resume where it left off.

Reads the Anthropic key from $ANTHROPIC_API_KEY, falling back to the web app's
env file, so it needs no key pasted in the UI.

Usage: python enrich_loop.py [model_id]   (model optional; defaults to DB setting)
"""
import os
import sys
import time

import db
import enrich

BATCH = 150
WEB_ENV = os.path.expanduser("~/.nanabanana-web.env")


def get_key():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    try:
        with open(WEB_ENV) as f:
            for line in f:
                if line.strip().startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return None


def main():
    model = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
    key = get_key()
    if not key:
        print("STOPPED: no ANTHROPIC_API_KEY found", flush=True)
        return

    conn = db.get_conn()
    start = enrich.pending_count(conn)
    conn.close()
    print(f"START pending={start} model={model or 'ברירת מחדל'}", flush=True)

    total = 0
    while True:
        conn = db.get_conn()
        pending = enrich.pending_count(conn)
        conn.close()
        if pending == 0:
            print("DONE — אין יותר אטרקציות להעשרה", flush=True)
            break
        try:
            done = enrich.enrich_pending(key, limit=BATCH, model=model)
        except Exception as e:  # credit / rate limit / network → stop cleanly
            print(f"STOPPED: {e}", flush=True)
            break
        total += done
        print(f"batch done={done} remaining={max(pending - done, 0)} (cum {total})", flush=True)
        if done == 0:
            print("STOPPED: לא בוצעה התקדמות (ייתכן שנגמר הקרדיט)", flush=True)
            break
        time.sleep(1)

    print(f"END total_enriched={total}", flush=True)


if __name__ == "__main__":
    main()
