"""Fill attractions.time_of_day — which parts of the day a place actually works.

Four values, and the column answers one question only: WHEN IS THIS A VALID
SLOT? (not "when is it nicest" — that advice already lives in best_time_he.)

    any      squares, streets, promenades, bridges, viewpoints, nightlife —
             fine from morning until late
    day      museums, markets, palaces, parks, memorials, zoos — daylight only.
             This is the value that stops the 22:30-at-a-memorial fall.
    morning  closes early (a produce market shutting at 14:00, a sunrise spot)
    evening  bars, night markets, shows — only after dark

Sources, weakest to strongest, each one allowed to narrow the one before it:
    1. kind      category + name (what sort of place is this)
    2. hours     the OSM opening_hours string, when we have it
    3. best_time free-text Hebrew from the enrichment pass
An editor value (time_of_day_src='editor') is never overwritten.

Usage:  .venv/bin/python scripts/classify_time_of_day.py [--apply] [--city ID]
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402

# ---------------------------------------------------------------- 1. by kind
# Open-air and social: the day does not shut these off.
OPEN_AIR_RX = re.compile(
    r"square|piazza|plaza|plein|platz|כיכר|רחוב|street|boulevard|שדרות|"
    r"promenade|טיילת|waterfront|bridge|גשר|viewpoint|תצפית|lookout|"
    r"רובע|quarter|district|nightlife|חיי לילה|\bbar\b|בר |pub|פאב|"
    r"club|מועדון|theatre|תיאטרון|opera|אופרה|concert|קונצרט|casino|קזינו",
    re.I,
)
# Shut, ticketed, or simply wrong once it is dark.
DAYLIGHT_RX = re.compile(
    r"museum|מוזיאון|gallery|גלריה|market|שוק|שווק|bazaar|memorial|אנדרט|הנצחה|"
    r"השואה|holocaust|zoo|גן ?חיות|aquarium|אקווריום|garden|גן בוטני|גינ[הת]|botanic|"
    r"park|פארק|castle|טיר[הת]|fortress|מבצר|palace|ארמון|cathedral|קתדרל|"
    r"church|כנסיי|monastery|מנזר|synagogue|בית הכנסת|mosque|מסגד|"
    r"archaeolog|ארכיאולוג|ruins|חורבות|cemetery|בית הקברות|"
    r"experience|חוויית|library|ספריי|beach|חוף|trail|מסלול|lake|אגם|"
    r"waterfall|מפל|cave|מער[הת]|island|אי |viewtower|מגדל תצפית|"
    r"acropol|אקרופוליס|parthenon|פרתנון|agora|אגורה|temple|מקדש|"
    r"סינגוג|tomb|קבר|גן |basilica|בזיליק|villa|וילה|forum|פורום|"
    r"amphitheat|אמפיתיאטרון|colosse|קולוסיאום|arena|זירת|thermae|"
    r"catacomb|קטקומב|crypt|קריפט|abbey|מנזר|baths|מרחצ",
    re.I,
)
DAYLIGHT_CATS = {"museum", "nature"}
OPEN_AIR_CATS: set[str] = set()

# ------------------------------------------------------------- 3. by best_time
EVENING_HE_RX = re.compile(r"שעות הערב|שעות הלילה|ערב ולילה|אחרי החשכה|לילה")
MORNING_ONLY_HE_RX = re.compile(r"בוקר בלבד|רק בבוקר|עד הצהריים|בוקר עד צהריים")
ALL_DAY_HE_RX = re.compile(r"כל שעות היום|כל שעות היממה|24")

LATE_MIN = 20 * 60 + 30   # matches the builder's after-dark cutoff
EARLY_CLOSE_MIN = 15 * 60  # shut by 15:00 → a morning place


def _hhmm(s: str) -> int | None:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", s.strip())
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def closing_minutes(oh: str | None) -> int | None:
    """Latest closing time in an OSM opening_hours string, in minutes.

    Deliberately forgiving: these strings carry seasons, public holidays and
    comments, and we only need the outer envelope. Unparseable → None, and the
    caller falls back to the kind.
    """
    if not oh:
        return None
    s = oh.strip()
    if not s or re.search(r"closed|off\b", s, re.I) and "24/7" not in s:
        if re.fullmatch(r"(?i)\s*closed[^;]*", s):
            return None
    if "24/7" in s:
        return 24 * 60
    best = None
    for a, b in re.findall(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", s):
        end = _hhmm(b)
        start = _hhmm(a)
        if end is None or start is None:
            continue
        if end <= start:          # crosses midnight, e.g. 20:00-02:00
            end = 24 * 60
        best = end if best is None else max(best, end)
    return best


def by_kind(name: str, cat: str | None, sub: str | None) -> str:
    """Unknown means "day". A place has to EARN the right to be offered at
    22:00; assuming a stranger is fine after dark is what put a Holocaust
    memorial at 22:30 in the first place. A false "day" only costs us one
    late option — a false "any" sends a family to a locked gate."""
    blob = f"{name} {cat or ''} {sub or ''}"
    # A named open-air/social place wins even inside a "nature" category —
    # a riverside promenade is filed under nature but works at 22:00.
    if OPEN_AIR_RX.search(blob) and not DAYLIGHT_RX.search(blob):
        return "any"
    return "day"


def classify(row) -> tuple[str, str]:
    """→ (time_of_day, source). Source is kept so the admin can see the why."""
    name, cat, sub, oh, best_time = row
    val = by_kind(name or "", cat, sub)
    src = "kind"

    close = closing_minutes(oh)
    if close is not None:
        if close <= EARLY_CLOSE_MIN:
            val, src = "morning", "hours"
        elif close < LATE_MIN:
            # Shuts before dark — daylight only, whatever the kind suggested.
            if val == "any":
                val, src = "day", "hours"
        # Deliberately NOT promoting day → any on late hours: a museum open
        # until 22:00 one night a week is still the wrong place to send a
        # family on a Tuesday, and OSM strings do not tell us which night.

    bt = (best_time or "").strip()
    if bt:
        if EVENING_HE_RX.search(bt):
            val, src = "evening", "best_time"
        elif MORNING_ONLY_HE_RX.search(bt):
            val, src = "morning", "best_time"
        elif ALL_DAY_HE_RX.search(bt) and val == "day" and close is None:
            # "כל שעות היום" on an open-air place with no hours: it is a
            # walk-through, not a ticketed site.
            if not DAYLIGHT_RX.search(f"{name} {cat or ''}"):
                val, src = "any", "best_time"
    return val, src


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to the DB")
    ap.add_argument("--city", type=int, help="one destination only")
    args = ap.parse_args()

    conn = db.get_conn()
    where = "quality_keep IS DISTINCT FROM 0 AND (is_duplicate IS NULL OR is_duplicate = 0)"
    params: list = []
    if args.city:
        where += " AND destination_id = %s"
        params.append(args.city)
    rows = conn.execute(
        f"SELECT id, name_he, category, subcategory, opening_hours, best_time_he,"
        f" time_of_day, time_of_day_src FROM attractions WHERE {where}", tuple(params)
    ).fetchall()

    counts: dict[str, int] = {}
    srcs: dict[str, int] = {}
    updates = []
    for r in rows:
        if r[7] == "editor":
            continue
        val, src = classify((r[1], r[2], r[3], r[4], r[5]))
        counts[val] = counts.get(val, 0) + 1
        srcs[src] = srcs.get(src, 0) + 1
        if r[6] != val or r[7] != src:
            updates.append((val, src, r[0]))

    total = sum(counts.values())
    print(f"{total} אטרקציות")
    for k in ("any", "day", "morning", "evening"):
        n = counts.get(k, 0)
        print(f"   {k:<8} {n:>6}  ({100 * n / max(total, 1):.1f}%)")
    print("   מקור:", ", ".join(f"{k}={v}" for k, v in sorted(srcs.items())))
    print(f"   לעדכון: {len(updates)}")

    if not args.apply:
        print("\n(יבש — הרץ עם --apply לכתיבה)")
        return
    # One statement per batch, ids grouped by (value, source) — the shim has no
    # executemany, and 13k round trips is not worth the wait.
    buckets: dict[tuple[str, str], list[int]] = {}
    for val, src, aid in updates:
        buckets.setdefault((val, src), []).append(aid)
    for (val, src), ids in buckets.items():
        for i in range(0, len(ids), 1000):
            conn.execute(
                "UPDATE attractions SET time_of_day = %s, time_of_day_src = %s WHERE id = ANY(%s)",
                (val, src, ids[i:i + 1000]),
            )
    conn.commit()
    print(f"נכתבו {len(updates)}")


if __name__ == "__main__":
    main()
