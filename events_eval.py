# -*- coding: utf-8 -*-
"""Phase 0b — the 'actuality' layer: match LIVE events to a couple's taste,
inside their exact trip dates. Mock London feed now (swap for Ticketmaster /
Bandsintown once a key exists); the matching logic is what we're proving.
"""
import datetime as dt

from eval_personas import YANIV, ADI, ROTEM, SHLOMIT, merge

WINDOW = (dt.date(2027, 2, 12), dt.date(2027, 2, 16))   # exact trip dates

# Both couples travel together → add a little 'romantic' weight (Valentine's).
BRIEFS = {
    "יניב + עדי": (dict(merge(YANIV, ADI), romantic=(3, False)),
                   {"artists": {"Metallica", "Foo Fighters"}, "teams": set()}),
    "רותם + שלומית": (dict(merge(ROTEM, SHLOMIT), romantic=(3, False)),
                      {"artists": {"Coldplay"}, "teams": {"Arsenal"}}),
}

# Mock live feed for the window (title, date, venue, taste tags, price£, artist, team, ongoing)
E = lambda t, d, v, tags, p, artist=None, team=None, ongoing=False: dict(
    title=t, date=dt.date(2027, 2, d), venue=v, tags=set(tags), price=p,
    artist=artist, team=team, ongoing=ongoing)
FEED = [
    E("מטאליקה — M72 World Tour", 13, "The O2", ["live_music"], 95, artist="Metallica"),
    E("ליל ג׳אז ב-Ronnie Scott's", 12, "Soho", ["live_music", "nightlife"], 45),
    E("ארסנל נגד צ׳לסי", 15, "Emirates Stadium", ["sports"], 70, team="Arsenal"),
    E("אגם הברבורים (בלט)", 14, "Royal Opera House", ["classical_opera"], 120),
    E("Hamilton", 13, "Victoria Palace, West End", ["theatre"], 85),
    E("ערב האהבה על הגג", 14, "The Shard", ["romantic", "nightlife"], 60),
    E("יריד וינטג׳ מיוחד", 15, "Camden Market", ["vintage_shopping"], 0),
    E("ליל מועדון ב-Fabric", 14, "Farringdon", ["nightlife", "live_music"], 30),
    E("ואן גוך — חוויה סוחפת", 12, "Seward Street", ["art"], 25, ongoing=True),
    E("אנגליה נגד צרפת — רוגבי Six Nations", 15, "Twickenham", ["sports"], 90),
    E("Wicked", 16, "Apollo Victoria, West End", ["theatre"], 75),
]


def score(ev, brief, follow):
    s = sum(w + (2 if must else 0) for tag, (w, must) in brief.items() if tag in ev["tags"])
    hit = None
    if ev["artist"] and ev["artist"] in follow["artists"]:
        s += 10; hit = f"⭐ אמן שאתם עוקבים: {ev['artist']}"
    if ev["team"] and ev["team"] in follow["teams"]:
        s += 10; hit = f"⭐ הקבוצה שלכם: {ev['team']}"
    return s, hit


def feed_for(brief, follow, n=6):
    out = []
    for ev in FEED:
        if not (WINDOW[0] <= ev["date"] <= WINDOW[1]):
            continue
        s, hit = score(ev, brief, follow)
        if s > 0:
            out.append((s, hit, ev))
    out.sort(key=lambda x: -x[0])
    return out[:n]


HE_DAY = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]


def main():
    print(f"טווח הטיול: {WINDOW[0]:%d/%m} – {WINDOW[1]:%d/%m}/2027  ·  לונדון\n")
    feeds = {}
    for label, (brief, follow) in BRIEFS.items():
        f = feed_for(brief, follow)
        feeds[label] = f
        print("=" * 66)
        print(f"קורה כשאתם שם — {label}")
        print("-" * 66)
        for (s, hit, ev) in f:
            when = f"{ev['date']:%d/%m} ({HE_DAY[ev['date'].weekday()]})" if not ev["ongoing"] else "לאורך השהות"
            tags = ",".join(sorted(ev["tags"]))
            price = "חינם" if ev["price"] == 0 else f"מ-£{ev['price']}"
            star = f"  {hit}" if hit else ""
            print(f"  {when:<16} {ev['title']:<30} @ {ev['venue']}  ({tags} · {price}){star}")
        print()

    print("#" * 66)
    la, lb = list(feeds)
    ida = {e[2]['title'] for e in feeds[la]}
    idb = {e[2]['title'] for e in feeds[lb]}
    def has(feed, kw): return any(kw in e[2]['title'] for e in feed)
    def ok(name, c): print(f"  [{'✓' if c else '✗'}] {name}")
    print("בדיקת פיצול אירועים:")
    ok("יניב+עדי מקבלים את מטאליקה", has(feeds[la], "מטאליקה"))
    ok("יניב+עדי לא מקבלים את משחק הכדורגל", not has(feeds[la], "ארסנל"))
    ok("רותם+שלומית מקבלים את ארסנל", has(feeds[lb], "ארסנל"))
    ok("רותם+שלומית מקבלים את הבלט", has(feeds[lb], "בלט"))
    ok("שני הזוגות מקבלים את ערב האהבה (14/2)", has(feeds[la], "האהבה") and has(feeds[lb], "האהבה"))
    print(f"\nחפיפה בין הפידים: {len(ida & idb)} אירועים · ייחודי ליניב {len(ida - idb)} · ייחודי לרותם {len(idb - ida)}")


if __name__ == "__main__":
    main()
