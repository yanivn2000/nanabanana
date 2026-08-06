"""Random, unplanned build smoke test. Each run picks a random city / days / pace /
audience, and randomly builds either pick-driven (WYSIWYG) or governed (no picks),
then asserts a sane itinerary came back. Run repeatedly while refactoring the Brain."""
import sys, json, math, random, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import db

API = "http://localhost:3000/api/itinerary"
CITIES = ["Amsterdam","Paris","Vienna","Berlin","Rome","Barcelona","Prague",
          "Greater London","New York","Salzburg","Crete","Porto","Lisbon","Krakow"]
conn = db.get_conn()
# cache: city -> dest row
_dest = {}
def dest(city):
    if city not in _dest:
        _dest[city] = conn.execute("SELECT id,lat,lng,mobility FROM destinations WHERE city=%s",(city,)).fetchone()
    return _dest[city]

def rand_picks(city, n):
    d = dest(city)
    rows = conn.execute("SELECT id FROM attractions WHERE destination_id=%s AND quality_keep=1 AND lat IS NOT NULL ORDER BY must_see DESC LIMIT 120",(d['id'],)).fetchall()
    ids = [r['id'] for r in rows]
    random.shuffle(ids)
    return ids[:n]

def post(body):
    req = urllib.request.Request(API, json.dumps(body).encode(), {"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

N = int(sys.argv[1]) if len(sys.argv) > 1 else 12
fails = []
for i in range(N):
    city = random.choice(CITIES)
    d = dest(city)
    if not d: continue
    days = random.choice([2,3,4,5])
    pace = str(random.choice([3,4,5,6]))
    aud = random.choice(["adults","families",None])
    pick_mode = random.random() < 0.6
    body = {"city": city, "days": days, "pace": pace}
    if aud: body["audience"] = aud
    tag = "governed"
    if pick_mode:
        cap = days*int(pace)
        picks = rand_picks(city, random.randint(max(3,cap-3), cap+8))
        body["selection"] = {"yes": picks, "no": []}
        tag = f"picks={len(picks)}"
    try:
        r = post(body)
    except Exception as e:
        fails.append(f"{city} d{days}p{pace} {aud} {tag}: EXCEPTION {e}"); print(f"  ✗ {city} d{days} p{pace} {aud} {tag}: EXCEPTION {e}"); continue
    it = r.get("itinerary", r); dd = it.get("days", [])
    sched = sum(len([s for s in x.get("stops",[]) if s.get("id") is not None]) for x in dd)
    left = len(r.get("leftOut", []))
    ok = len(dd) >= 1 and sched >= 1
    # governed builds should generally reach multiple days for days>=3 metros with enough pool
    print(f"  {'✓' if ok else '✗'} {city} ({d['mobility']}) d{days} p{pace} {aud or '-'} {tag}: days={len(dd)} sched={sched} left={left}")
    if not ok:
        fails.append(f"{city} d{days}p{pace} {aud} {tag}: days={len(dd)} sched={sched}")

conn.close()
print("\n=== " + ("ALL OK" if not fails else f"{len(fails)} FAILURES") + " ===")
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
