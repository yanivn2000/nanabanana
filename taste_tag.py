# -*- coding: utf-8 -*-
"""Taste-tag attractions — the taste layer on the attraction side (Phase 0).

Rule-based over name + tagline + our hand-written description (rich, accurate
signal). Structural tags always come from category; taste tags require SPECIFIC
keywords (deliberately avoiding ambiguous ones like bare 'chelsea'/'market').
Prints taste-tagged members per tag for human review, then stores.
"""
import json
import re
import sys

import db

# taste-tag → regex (case-insensitive) over name_he+name_en+tagline+description
TASTE = {
    "vintage_shopping": r"vintage|flea market|camden (?:market|lock|stables)|brick ?lane|portobello|spitalfields market|שוק קמדן|אורוות קמדן|ברק ליין|בריק ליין|פורטובלו|וינטג|יד ?שנייה|שוק הספרים",
    "luxury_shopping":  r"harrods|selfridge|harvey nichols|fortnum|liberty london|bond street|\bboutique\b|הארודס|יוקרה|בונד סטריט",
    "live_music":       r"\bo2 arena\b|brixton academy|roundhouse|\bkoko\b|\bjazz\b|live music|abbey road|handel|hendrix|academy of music|college of music|musical museum|הופעות חיות|ג׳אז|אבי רוד|אביי רוד|המוזיאון המוזיקלי|האקדמיה המלכותית למוזיקה|המכללה המלכותית למוזיקה",
    "classical_opera":  r"\bopera(?!ting|tion)|philharmon|symphony orchestra|royal opera|אופרה|תזמורת|קונצרט קלאסי",
    "theatre":          r"(?<!operating )theatre|(?<!amphi)theater|west ?end|globe theatre|shakespeare|palladium|\bmusical\b|תיאטרון(?! )?ה?גלוב|תיאטרון|מחזמר|ווסט אנד|שייקספיר",
    "nightlife":        r"nightclub|cocktail bar|\bbar crawl\b|מועדון|חיי לילה|צ׳יינה טאון|chinatown",
    "sports":           r"\bstadium\b|wembley|emirates stadium|stamford bridge|twickenham|lord'?s cricket|the oval|arsenal|כדורגל|אצטדיון|ארסנל|וומבלי|טוטנהאם|tottenham hotspur",
    "food":             r"borough market|food market|street food|foodie|gastro|שוק אוכל|אוכל רחוב|קולינרי|שוק האוכל",
    "family":           r"\bzoo\b|aquarium|sea ?life|playground|petting|גן חיות|אקווריום|מגרש משחקים|פינת החיות|מוזיאון לילדים|קידז|kids",
}
# hard removals: keyword hit but semantically wrong (by name substring)
FALSE = {
    "theatre": ("operating", "ניתוח", "אמפי", "amphi"),
    "classical_opera": ("operating", "ניתוח", "מבצעים", "operations", "soe"),
    "family": ("קינדרטרנספורט", "למען הילד", "קבר"),  # memorials, not activities
    "vintage_shopping": ("פנטון", "fenton"),
    "luxury_shopping": ("קיוב", "cube", "וויט"),        # White Cube = art gallery
    "nightlife": ("ארסנל", "arsenal"),                   # football 'club', not a club
}
# structural (from category/subcategory)
def structural(a):
    tags = set()
    cat, sub = a["category"], a["subcategory"]
    if cat == "nature" or sub in ("park", "garden", "nature_reserve", "viewpoint"):
        tags.add("nature")
    if sub in ("viewpoint",):
        tags.add("viewpoint")
    if cat == "museum" or sub in ("museum", "gallery"):
        tags.add("art")
    if cat == "historic" or sub in ("castle", "memorial", "monument", "artwork"):
        tags.add("history")
    if a["must_see"]:
        tags.add("landmark")
    if sub in ("zoo", "aquarium"):
        tags.add("family")
    return tags


def tag(a):
    hay = " ".join(str(a[k] or "") for k in ("name_he", "name_en", "tagline_he", "description_he"))
    name = (a["name_he"] or "") + " " + (a["name_en"] or "")
    tags = structural(a)
    for t, pat in TASTE.items():
        if re.search(pat, hay, re.I):
            if t in FALSE and any(bad.lower() in name.lower() for bad in FALSE[t]):
                continue
            tags.add(t)
    return sorted(tags)


def main(dest=14, apply=False):
    c = db.get_conn()
    rows = c.execute(
        "SELECT id,name_he,name_en,tagline_he,description_he,category,subcategory,must_see "
        "FROM attractions WHERE destination_id=%s AND quality_keep=1 "
        "AND (is_component IS NULL OR is_component=0)", (dest,)).fetchall()
    tagged = {a["id"]: tag(a) for a in rows}
    names = {a["id"]: (a["name_he"] or a["name_en"]) for a in rows}

    from collections import defaultdict
    by_tag = defaultdict(list)
    for aid, ts in tagged.items():
        for t in ts:
            by_tag[t].append(names[aid])

    TASTE_KEYS = list(TASTE)
    print(f"=== London kept attractions: {len(rows)} ===\n")
    for t in TASTE_KEYS:
        print(f"--- {t} ({len(by_tag[t])}) ---")
        print("   " + " · ".join(by_tag[t]))
        print()
    print("structural:", {t: len(by_tag[t]) for t in ("nature", "art", "history", "landmark")})

    if apply:
        for aid, ts in tagged.items():
            c.execute("UPDATE attractions SET taste_tags=%s WHERE id=%s", (json.dumps(ts), aid))
        c.commit()
        print("\nSTORED taste_tags for", len(tagged), "attractions.")
    c.close()


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
