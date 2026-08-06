"""Stress-test the pick-driven build (round-robin selection) across cities + day
counts, flagging weird results. Picks a balanced set of central attractions per
city, builds via the API (by CITY name — the route resolves dest by name), and
checks each itinerary for: collapses, empty/duplicate days, over/underfill, and
type domination (round-robin should spread types when over-picked)."""
import sys, json, math, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import db
from collections import Counter

API = "http://localhost:3000/api/itinerary"
CITIES = [("Greater London","metro"),("Paris","metro"),("Vienna","metro"),
          ("New York","metro"),("Berlin","metro"),("Rome","metro"),
          ("Barcelona","metro"),("Prague","metro"),
          ("Salzburg","car_base"),("Crete","car_base")]
COMBOS = [(2,"5"),(3,"5"),(4,"6")]   # (days, pace)

conn = db.get_conn()

def km(a,b,c,d):
    R=6371;p=math.radians
    return R*2*math.asin(math.sqrt(math.sin(p(c-a))**2/1+math.cos(p(a))*math.cos(p(c))*math.sin(p((d-b)/2))**2)) if False else R*2*math.asin(math.sqrt(math.sin(p((c-a)/2))**2+math.cos(p(a))*math.cos(p(c))*math.sin(p((d-b)/2))**2))

def pick_for(dest_id, lat, lng):
    rows = conn.execute("""SELECT id, category, lat, lng, name_he FROM attractions
        WHERE destination_id=%s AND quality_keep=1 AND lat IS NOT NULL ORDER BY must_see DESC, id""",(dest_id,)).fetchall()
    # central-ish: within 6km of center; up to 4 per category, ~24 total
    by={}
    for r in rows:
        if km(lat,lng,r['lat'],r['lng'])>6: continue
        by.setdefault(r['category'],[]).append(r['id'])
    picks=[]
    for c,ids in by.items(): picks+=ids[:4]
    return picks[:24], {c:len(v[:4]) for c,v in by.items()}

def post(city, days, pace, picks):
    body=json.dumps({"city":city,"days":days,"pace":pace,"selection":{"yes":picks,"no":[]}}).encode()
    req=urllib.request.Request(API, body, {"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def cats_of(ids):
    if not ids: return {}
    rows=conn.execute("SELECT id,category FROM attractions WHERE id = ANY(%s)",(ids,)).fetchall()
    m={r['id']:r['category'] for r in rows}
    return Counter(m.get(i,'?') for i in ids)

anomalies=[]
for city,mob in CITIES:
    d=conn.execute("SELECT id,lat,lng FROM destinations WHERE city=%s",(city,)).fetchone()
    picks,pick_dist=pick_for(d['id'], d['lat'], d['lng'])
    print(f"\n=== {city} ({mob}) — {len(picks)} picks across {len(pick_dist)} types: {pick_dist}")
    for days,pace in COMBOS:
        perday=int(pace); cap=days*perday
        try:
            r=post(city,days,pace,picks)
        except Exception as e:
            anomalies.append(f"{city} d{days}p{pace}: HTTP/ERR {e}"); print(f"  d{days} p{pace}: ERROR {e}"); continue
        it=r.get('itinerary',r); dd=it.get('days',[])
        sched=[]; per=[]; evening=set()
        for x in dd:
            s=[st['id'] for st in (x.get('stops') or []) if st.get('id') is not None]
            # A curated evening street may legitimately repeat on a second night
            # (docs/logic/repeat-visits.md) — those are the LAST stop of a day,
            # after 20:30. Everything else repeating is a real duplicate.
            for st in (x.get('stops') or []):
                tm=st.get('time') or ''
                if st.get('id') is not None and len(tm)>=5 and int(tm[:2])*60+int(tm[3:5])>=20*60+30:
                    evening.add(st['id'])
            sched+=s; per.append(len(s))
        left=len(r.get('leftOut',[]))
        ctypes=cats_of(sched)
        dom=max(ctypes.values())/len(sched) if sched else 0
        print(f"  d{days} p{pace} cap{cap}: days={len(dd)} perDay={per} scheduled={len(sched)} left={left} types={dict(ctypes)} dom={dom:.0%}")
        # anomaly checks
        if len(sched)==0: anomalies.append(f"{city} d{days}p{pace}: ZERO scheduled")
        if any(p==0 for p in per): anomalies.append(f"{city} d{days}p{pace}: EMPTY day {per}")
        dayStops=[i for i in sched if i not in evening]
        if len(dayStops)!=len(set(dayStops)): anomalies.append(f"{city} d{days}p{pace}: DUPLICATE stops")
        over=[i for i in set(evening) if sched.count(i)>2]
        if over: anomalies.append(f"{city} d{days}p{pace}: evening spot repeated >2x")
        # collapse: metro city, enough central picks, but days built << requested
        if mob=="metro" and len(picks)>=cap and len(dd)<days:
            anomalies.append(f"{city} d{days}p{pace}: COLLAPSE days={len(dd)}<{days} (picks={len(picks)},sched={len(sched)})")
        # severe underfill: metro, picks>=cap but scheduled < cap-2
        if mob=="metro" and len(picks)>=cap and len(sched)<cap-2:
            anomalies.append(f"{city} d{days}p{pace}: UNDERFILL sched={len(sched)}<cap{cap} (picks={len(picks)})")
        # type domination when over-picked & picks balanced (>=4 types)
        if len(picks)>cap and len(pick_dist)>=4 and dom>0.6:
            anomalies.append(f"{city} d{days}p{pace}: TYPE-DOMINATION {dom:.0%} {dict(ctypes)}")

conn.close()
print("\n\n########## ANOMALIES ##########")
if not anomalies: print("NONE — all builds look sane.")
else:
    for a in anomalies: print(" -",a)
