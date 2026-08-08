"""Link enclosure-style sub-attractions to the venue that contains them.

The Brain's quality report exposed it: Prague's build put "פנדה אדומה — גן חיות"
and "צ'יטות — גן חיות" on day 2 and "גורילות — גן חיות (2)" on day 3. Those are
three enclosures inside ONE zoo, so the trip sent a family across the river to
Troja twice and bought admission twice. In London "ממלכת הגורילות — גן החיות
לונדון" is even flagged must_see=1 while London Zoo itself is not.

The engine already knows how to handle this — attractions.parent_id makes a row
fold into its parent (heuristic.sameVisit, cluster.ts, traits.countVisits). The
data simply never linked them: OSM maps every enclosure as its own node, and the
ingest kept them all as top-level attractions.

Deliberately narrow. A wrong parent_id HIDES a real attraction, which is worse
than the bug being fixed, so a child must clear all of:
  - it names the venue kind (zoo/aquarium/safari/botanical garden…)
  - it carries an enclosure marker: a dash-separated suffix, "ב-<venue>", "אזור"
  - it is short (< 120 min) while the container is a half-day venue
  - it is within 600 m of the container
  - exactly ONE container matches — ambiguity is skipped, never guessed

Usage:  .venv/bin/python scripts/link_venue_children.py [--apply] [--city ID]
"""
import argparse
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402

# Venue kinds whose sub-parts are enclosures, not destinations of their own.
VENUE_RX = re.compile(r"גן החיות|גן חיות|אקווריום|ספארי|לונה פארק|פארק שעשועים|"
                      r"הגן הבוטני|גן בוטני|דולפינריום")
# What marks a row as a PART of the venue rather than the venue itself.
CHILD_RX = re.compile(r"[—–-]\s*\S|\bב(?:גן|אקווריום)|אזור |ביתן |מתחם |טרמווי|"
                      r"פינת |בית ה")
CONTAINER_MIN = 120     # a half-day venue
CHILD_MAX = 119
RADIUS_KM = 0.6


def km(a: float, b: float, x: float, y: float) -> float:
    return 6371 * 2 * math.asin(math.sqrt(
        math.sin(math.radians(x - a) / 2) ** 2
        + math.cos(math.radians(a)) * math.cos(math.radians(x))
        * math.sin(math.radians(y - b) / 2) ** 2))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--city", type=int)
    args = ap.parse_args()
    conn = db.get_conn()

    where = ("a.quality_keep IS DISTINCT FROM 0 AND (a.is_duplicate IS NULL OR a.is_duplicate = 0)"
             " AND a.lat IS NOT NULL AND a.name_he IS NOT NULL")
    params: list = []
    if args.city:
        where += " AND a.destination_id = %s"
        params.append(args.city)
    rows = conn.execute(
        f"SELECT a.id, a.destination_id, a.name_he, a.lat, a.lng, a.duration_minutes,"
        f" a.parent_id, a.must_see, d.city_he, a.is_component FROM attractions a"
        f" JOIN destinations d ON d.id = a.destination_id WHERE {where}", tuple(params)
    ).fetchall()

    by_dest: dict[int, list] = {}
    for r in rows:
        by_dest.setdefault(r[1], []).append(r)

    links, skipped = [], []
    for rs in by_dest.values():
        containers = [r for r in rs if (r[5] or 0) >= CONTAINER_MIN
                      and VENUE_RX.search(r[2]) and not CHILD_RX.search(r[2])]
        if not containers:
            continue
        for a in rs:
            if (a[6] is not None and a[9] == 1) or (a[5] or 0) > CHILD_MAX:
                continue
            if not VENUE_RX.search(a[2]) or not CHILD_RX.search(a[2]):
                continue
            near = [v for v in containers if v[0] != a[0]
                    and km(v[3], v[4], a[3], a[4]) <= RADIUS_KM]
            if len(near) == 1:
                links.append((a, near[0]))
            elif near:
                skipped.append(f"{a[8]}: '{a[2]}' — {len(near)} מתחמים אפשריים")

    print(f"{len(links)} תת-אתרים יקושרו למתחם שלהם:")
    cur = None
    for a, v in sorted(links, key=lambda x: (x[0][8] or "", x[1][2])):
        if (a[8], v[2]) != cur:
            cur = (a[8], v[2])
            print(f"\n  {a[8]} · {v[2]} (#{v[0]})")
        star = " ⭐must-see!" if a[7] == 1 else ""
        print(f"      {a[2]}{star}")
    for s in skipped:
        print("  ⚠️ דילוג —", s)

    if not args.apply:
        print("\n(יבש — הרץ עם --apply לכתיבה)")
        return
    # A child that was a must-see was carrying the venue's reputation (London's
    # gorilla enclosure was must-see while London Zoo was not). Move that flag UP
    # rather than dropping it — otherwise this fix would quietly remove the zoo
    # from family trips, and the builder only folds children when the PARENT made
    # the pool (heuristic.ts).
    promote = {v[0] for a, v in links if a[7] == 1}
    # is_component is what actually keeps a part out of every pool (db.ts); the
    # parent_id link alone only says "same visit" for rows that DID get picked.
    # A giraffe enclosure is never a stop — nobody plans their day around it —
    # so these get both.
    for a, v in links:
        conn.execute("UPDATE attractions SET parent_id = %s, is_component = 1, must_see = 0"
                     " WHERE id = %s", (v[0], a[0]))
    if promote:
        conn.execute("UPDATE attractions SET must_see = 1 WHERE id = ANY(%s) AND must_see IS DISTINCT FROM 1",
                     (list(promote),))
    conn.commit()
    print(f"\nקושרו {len(links)} · הועלו ל'חובה' {len(promote)} מתחמים")


if __name__ == "__main__":
    main()
