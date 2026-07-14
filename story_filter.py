"""Hide 'no-story' filler attractions.

OSM tags every commercial art gallery, neighbourhood garden, small park and dog
park as tourism/leisure, so the ingest pulls in hundreds of places per city that
have no reason to be shown to someone planning a week-long trip. Principle: a
place only shows if it has a *story* — a Wikipedia/Wikidata article, a curated
must-see flag, or a written tagline/description explaining why it's interesting.

This pass hides the no-story rows that fall in filler subcategories (galleries,
gardens, parks, dog parks, generic points). Historic sites, nature and museums
are deliberately kept even without a story signal — they have inherent tourist
relevance and should be ENRICHED (given a tagline) rather than hidden.

Reversible (only sets quality_keep=0). NULL/1 story rows are untouched, so it's
safe to re-run after an ingest. Run:  python story_filter.py --apply
"""
import sys
import db

# filler subcategories that aren't a tourist attraction without an explicit story
FILLER = ("gallery", "dog_park", "garden", "park", "parklet", "attraction",
          "information", "sports_centre", "trampoline_park", "artwork", "yes")

SHOWN = ("(quality_keep=1 OR quality_keep IS NULL) "
         "AND (is_duplicate IS NULL OR is_duplicate=0) "
         "AND (is_component IS NULL OR is_component=0)")
NOSTORY = ("(info_sources IS NULL OR info_sources::text IN ('[]','null')) "
           "AND (must_see IS NULL OR must_see=0) "
           "AND (tagline_he IS NULL OR tagline_he='') "
           "AND (description_he IS NULL OR description_he='')")


def run(apply=False):
    conn = db.get_conn()
    subs = ",".join(f"'{s}'" for s in FILLER)
    where = f"{SHOWN} AND {NOSTORY} AND subcategory IN ({subs})"
    n = conn.execute(f"SELECT count(*) FROM attractions WHERE {where}").fetchone()[0]
    if apply:
        conn.execute(f"UPDATE attractions SET quality_keep=0 WHERE {where}")
        conn.commit()
    print(f"{'hid' if apply else 'would hide'} {n} no-story filler attractions")
    conn.close()
    return n


if __name__ == "__main__":
    run(apply="--apply" in sys.argv)
