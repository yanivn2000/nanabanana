# -*- coding: utf-8 -*-
"""Phase 0b — read happenings from the DB, match by TIME-shape × taste × follows.

Proves the extensible pipeline: one matcher handles point / run / recurring /
annual / seasonal. A Feb window surfaces gigs+matches+musical-runs+markets+
Valentine's; a Dec window surfaces the Christmas season — same code, no changes.
"""
import datetime as dt

import db
from eval_personas import YANIV, ADI, ROTEM, SHLOMIT, merge

LONDON = 14
HE_DAY = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]

BRIEFS = {
    "יניב + עדי": (dict(merge(YANIV, ADI), romantic=(3, False)),
                   {"artists": {"Metallica", "Foo Fighters"}, "teams": set()}),
    "רותם + שלומית": (dict(merge(ROTEM, SHLOMIT), romantic=(3, False)),
                      {"artists": {"Coldplay"}, "teams": {"Arsenal"}}),
}


def _mmdd(s, year):
    m, d = map(int, s.split("-")); return dt.date(year, m, d)


def occurs(h, frm, to):
    t, s, e, recur = h["temporal"], h["start_date"], h["end_date"], h["recur"]
    if t == "point":
        return bool(s) and frm <= s <= to
    if t == "run":
        return bool(s and e) and not (e < frm or s > to)
    if t == "recurring":
        days = {int(x) for x in recur.split(":")[1].split(",")} if recur else set()
        d = frm
        while d <= to:
            if (not s or d >= s) and (not e or d <= e) and (not days or d.weekday() in days):
                return True
            d += dt.timedelta(days=1)
        return False
    if t == "annual":
        return any(frm <= _mmdd(recur, y) <= to for y in range(frm.year, to.year + 1))
    if t == "seasonal":
        a, b = recur.split("..")
        for y in range(frm.year - 1, to.year + 1):
            ps, pe = _mmdd(a, y), _mmdd(b, y)
            if pe < ps:
                pe = _mmdd(b, y + 1)
            if not (pe < frm or ps > to):
                return True
        return False
    return False


def when_label(h, frm, to):
    t = h["temporal"]
    if t == "point":
        return f"{h['start_date']:%d/%m} ({HE_DAY[h['start_date'].weekday()]})"
    if t == "annual":
        for y in range(frm.year, to.year + 1):
            d = _mmdd(h["recur"], y)
            if frm <= d <= to:
                return f"{d:%d/%m} ({HE_DAY[d.weekday()]})"
    if t == "run":
        return "לאורך השהות"
    if t == "recurring":
        days = {int(x) for x in h["recur"].split(":")[1].split(",")}
        return "כל יום" if len(days) >= 7 else "בימים " + ",".join(HE_DAY[d] for d in sorted(days))
    if t == "seasonal":
        return "עונתי (בתקופת השהות)"
    return "—"


def score(h, brief, follow):
    tags = set(db.jloads(h["taste_tags"]))
    s = sum(w + (2 if must else 0) for tag, (w, must) in brief.items() if tag in tags)
    hit = None
    perf = set(db.jloads(h["performers"]))
    if perf & follow["artists"]:
        s += 10; hit = f"⭐ אמן שאתם עוקבים: {', '.join(perf & follow['artists'])}"
    if perf & follow["teams"]:
        s += 10; hit = f"⭐ הקבוצה שלכם: {', '.join(perf & follow['teams'])}"
    return s, hit


def feed(rows, brief, follow, frm, to, n=8):
    out = []
    for h in rows:
        if not occurs(h, frm, to):
            continue
        s, hit = score(h, brief, follow)
        if s > 0:
            out.append((s, hit, h))
    out.sort(key=lambda x: -x[0])
    return out[:n]


def run_window(rows, frm, to, title):
    print("\n" + "#" * 68)
    print(f"{title}  ·  {frm:%d/%m} – {to:%d/%m}/{to.year}  ·  לונדון")
    print("#" * 68)
    feeds = {}
    for label, (brief, follow) in BRIEFS.items():
        f = feed(rows, brief, follow, frm, to)
        feeds[label] = f
        print(f"\n— קורה כשאתם שם · {label} —")
        for (s, hit, h) in f:
            price = "חינם" if (h["price_from"] or 0) == 0 else f"מ-£{int(h['price_from'])}"
            star = f"  {hit}" if hit else ""
            print(f"  {when_label(h, frm, to):<20} {h['title_he']:<28} ({','.join(db.jloads(h['taste_tags']))} · {price}){star}")
    return feeds


def main():
    c = db.get_conn()
    rows = c.execute("SELECT * FROM happenings WHERE destination_id=%s", (LONDON,)).fetchall()
    c.close()

    feb = run_window(rows, dt.date(2027, 2, 12), dt.date(2027, 2, 16), "חלון 1 — פברואר")
    dec = run_window(rows, dt.date(2027, 12, 21), dt.date(2027, 12, 26), "חלון 2 — דצמבר (אותו קוד, אפס שינוי)")

    def has(f, kw): return any(kw in e[2]["title_he"] for e in f)
    def ok(name, cond): print(f"  [{'✓' if cond else '✗'}] {name}")
    la, lb = list(BRIEFS)
    print("\n" + "=" * 68 + "\nבדיקות (טעם × זמן × עוקב):")
    ok("פב׳: יניב מקבל מטאליקה (point + עוקב)", has(feb[la], "מטאליקה"))
    ok("פב׳: רותם מקבל ארסנל (point + קבוצה)", has(feb[lb], "ארסנל"))
    ok("פב׳: שני הזוגות מקבלים מחזמר רץ (run)", has(feb[la], "Hamilton") and has(feb[lb], "Hamilton"))
    ok("פב׳: יום האהבה מופיע (annual 14/2)", has(feb[la], "האהבה"))
    ok("פב׳: קמדן מופיע (recurring)", has(feb[la], "קמדן"))
    ok("פב׳: חג המולד לא מופיע (מחוץ לחלון)", not has(feb[la], "חג המולד"))
    ok("דצמ׳: שוקי חג המולד מופיעים (seasonal)", has(dec[la], "חג המולד") or has(dec[la], "חג"))
    ok("דצמ׳: מטאליקה לא מופיע (מחוץ לחלון)", not has(dec[la], "מטאליקה"))


if __name__ == "__main__":
    main()
