# -*- coding: utf-8 -*-
"""Phase 0 — golden-personas eval harness for ultra-personalization.

Encodes 4 travellers + 2 couples, taste-tags our London attractions (keyword +
category, a stand-in for a real AI taste-enrichment), scores each attraction for
each couple's merged 'taste brief', and prints the two couples' top picks
side-by-side + divergence assertions. No AI, no external APIs — runs instantly.
"""
import re
import db

LONDON = 14

# --- taste vocabulary: how we tag an attraction ------------------------------
KW = {
    "vintage_shopping": r"vintage|flea|camden|brick ?lane|portobello|spitalfields|\bmarket\b|וינטג|שוק|קמדן",
    "luxury_shopping":  r"harrods|selfridge|liberty|fortnum|bond street|regent street|knightsbridge|mayfair|boutique|luxury|הארודס|יוקרה",
    "live_music":       r"\bo2\b|arena|concert|\bgig\b|jazz|live music|music venue|koko|roundhouse|brixton academy|הופע|מוזיק|קונצרט",
    "nightlife":        r"nightclub|\bclub\b|cocktail|\bsoho\b|nightlife|מועדון",
    "sports":           r"stadium|wembley|emirates|stamford bridge|arsenal|chelsea|tottenham|twickenham|lord'?s|the oval|football|אצטדיון|כדורגל",
    "theatre_ballet":   r"theatre|theater|west ?end|opera|ballet|musical|shakespeare|globe|palladium|תיאטרון|בלט|אופרה|מחזמר",
}
SUB_TAG = {  # subcategory / category → structural taste tag
    "park": "nature", "garden": "nature", "nature_reserve": "nature", "viewpoint": "nature",
    "museum": "museum", "gallery": "museum",
    "memorial": "history", "monument": "history", "castle": "history", "artwork": "history",
    "zoo": "family", "aquarium": "family",
}


def tags_for(a):
    return set(db.jloads(a["taste_tags"]))          # read the STORED taste layer


# --- personas (weighted taste; 'must' = non-negotiable) ----------------------
YANIV = {"live_music": (5, True), "vintage_shopping": (5, False), "nightlife": (4, False),
         "theatre": (3, False), "food": (3, False), "nature": (2, False),
         "art": (2, False), "landmark": (2, False)}
ADI = {"vintage_shopping": (5, False), "live_music": (5, False), "nightlife": (4, False),
       "theatre": (3, False), "nature": (2, False), "art": (2, False), "landmark": (2, False)}
ROTEM = {"sports": (5, True), "luxury_shopping": (4, False), "theatre": (3, False),
         "art": (3, False), "history": (3, False), "landmark": (2, False),
         "live_music": (2, False), "nature": (1, False)}
SHLOMIT = {"classical_opera": (5, True), "theatre": (4, False), "luxury_shopping": (5, False),
           "art": (3, False), "history": (3, False), "landmark": (2, False), "nature": (1, False)}

STYLE = {"yaniv": dict(walk_km=10, structure="loose"), "rotem": dict(walk_km=3, structure="structured")}


def merge(*people):
    """Merge people into a group brief: max weight per tag; must = union."""
    brief = {}
    for p in people:
        for tag, (w, must) in p.items():
            cur_w, cur_m = brief.get(tag, (0, False))
            brief[tag] = (max(cur_w, w), cur_m or must)
    return brief


def score(a, brief):
    at = tags_for(a)
    s = sum(w + (3 if must else 0) for tag, (w, must) in brief.items() if tag in at)
    s += 0.1 * (a["family_score"] or 0)          # gentle tiebreak
    return s, at


def top_for(rows, brief, n=15):
    scored = [(score(a, brief), a) for a in rows]
    scored = [(s, at, a) for (s, at), a in scored if s > 0]
    scored.sort(key=lambda x: -x[0])
    return scored[:n]


def main():
    c = db.get_conn()
    rows = c.execute(
        "SELECT id,name_he,name_en,taste_tags,family_score,must_see "
        "FROM attractions WHERE destination_id=%s AND quality_keep=1 "
        "AND (is_component IS NULL OR is_component=0)", (LONDON,)).fetchall()
    c.close()

    couples = {
        "יניב + עדי  (מוזיקה · וינטג' · לצאת · 10 ק\"מ · גמיש)": (merge(YANIV, ADI), "yaniv"),
        "רותם + שלומית  (ספורט · בלט · יוקרה · מעט הליכה · מסודר)": (merge(ROTEM, SHLOMIT), "rotem"),
    }

    picks = {}
    for label, (brief, style_key) in couples.items():
        top = top_for(rows, brief, 15)
        picks[label] = top
        print("\n" + "=" * 70)
        print(label)
        print(f"סגנון: {STYLE[style_key]['walk_km']} ק\"מ/יום · {STYLE[style_key]['structure']}")
        print("-" * 70)
        for (s, at, a) in top:
            taste = ",".join(sorted(at & set(brief)))
            print(f"  {s:5.1f}  {a['name_he'] or a['name_en']:<34}  [{taste}]")

    # --- divergence assertions ---
    print("\n" + "#" * 70)
    print("בדיקת פיצול — כמה מכל תג-טעם נכנס ל-top-15 של כל זוג:")
    print("#" * 70)
    TAGS = ["vintage_shopping", "live_music", "nightlife", "sports", "theatre", "classical_opera", "luxury_shopping", "art", "history", "nature"]
    labels = list(picks)
    header = f"{'tag':<18} | {'יניב+עדי':>10} | {'רותם+שלומית':>12}"
    print(header)
    counts = {lab: {t: sum(1 for (_, at, _) in picks[lab] if t in at) for t in TAGS} for lab in labels}
    for t in TAGS:
        print(f"{t:<18} | {counts[labels[0]][t]:>10} | {counts[labels[1]][t]:>12}")

    def ok(name, cond):
        print(f"  [{'✓' if cond else '✗'}] {name}")
    y, r = counts[labels[0]], counts[labels[1]]
    print("\nטענות:")
    ok("יניב+עדי: יותר וינטג' מרותם", y["vintage_shopping"] > r["vintage_shopping"])
    ok("יניב+עדי: יותר מוזיקה חיה מרותם", y["live_music"] >= r["live_music"])
    ok("רותם+שלומית: יותר ספורט מיניב", r["sports"] > y["sports"])
    ok("רותם+שלומית: יותר תיאטרון/אופרה מיניב",
       (r["theatre"] + r["classical_opera"]) > (y["theatre"] + y["classical_opera"]))
    ok("רותם+שלומית: יותר יוקרה מיניב", r["luxury_shopping"] >= y["luxury_shopping"])
    # overlap of the two top-15 sets (lower = more personalized divergence)
    s1 = {a["id"] for (_, _, a) in picks[labels[0]]}
    s2 = {a["id"] for (_, _, a) in picks[labels[1]]}
    print(f"\nחפיפה בין שתי הרשימות: {len(s1 & s2)}/15  (נמוך = פיצול חזק יותר)")


if __name__ == "__main__":
    main()
