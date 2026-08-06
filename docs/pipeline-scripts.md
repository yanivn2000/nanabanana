# The pipeline scripts — what each one is for, and when to run it

Everything here is **free**: OpenStreetMap/Overpass, Wikipedia, Wikidata and
Wikimedia Commons, plus the local dev server for the two stress tests. None of
them call the paid Anthropic API — Hebrew content is authored by a Claude session
reading the spec in [docs/logic/](./logic/), never billed per row. See
[docs/logic/README.md](./logic/README.md) for that rule.

All of them are idempotent and additive: re-running fills gaps, it does not
overwrite work that is already there.

## Adding cities

| script | what it does | when to run it |
|---|---|---|
| `build_cities.py` | The whole new-city pipeline end to end: OSM ingest (12 km core) → city_he/country_he/mobility → Wikimedia images → grounded Hebrew → Hebrew names → taste tags → hide the no-story junk. `--ingest-only` / `--enrich-only` split the phases. | Adding a batch of destinations. This is the entry point; the three below are its recovery and follow-up tools. |
| `recover_enrich.py` | Re-runs the enrichment passes that **crashed** (dropped DB/network connections), retrying until one clean full pass. `--since-id N` points it at a batch other than the El Al one (34+). | A `build_cities.py` run died partway. |
| `redo_descriptions.py` | Re-runs the grounded Hebrew-description pass until coverage stops growing (two flat passes = done). | A run **completed** but description coverage is low — usually a flaky network during the Wikipedia calls. |
| `derive_mustsee.py` | Heuristic first-pass must-see for a city that has none: ranks by real Hebrew description → family_score → rating volume → distance from the centre, gated on having a Wikipedia/Wikidata source. `--city N`, `--since-id N`, `--top N`. | A new city needs a launchable must-see tier before hand-curation. **Skips any city that already has must-sees** — hand-curation is never buried under heuristics (`--force` overrides). |

## Content

| script | what it does | when to run it |
|---|---|---|
| `street_images.py` | Photos for approved streets, with **coordinate verification**: a Wikipedia article's lead image is only accepted if the article's own coordinates sit within ~2 km of the street. That is what rejects homonyms — an actor, a map, a same-named street in another city. No coordinates on the article → rejected. | After approving new streets. Streets it cannot verify stay blank for a hand-supplied image, which is the intended outcome. |

## Stress tests (need `npm run dev` on :3000)

| script | what it does | when to run it |
|---|---|---|
| `test_random_builds.py` | Random unplanned smoke test — random city / days / pace / audience, randomly pick-driven or governed, asserts a sane itinerary came back. | Repeatedly while refactoring the Brain or the builder. Cheap and it catches crashes no targeted test looks for. |
| `test_roundrobin.py` | Targeted stress of the pick-driven build across cities × day counts: flags day collapses, empty or duplicate days, over/underfill, and one type dominating a day. | After touching selection, clustering or the per-day caps. |

## Why they are in git

They were untracked for a long while, which meant the only copy of the
new-city pipeline lived on one laptop. They are small, they encode decisions
worth keeping (the 12 km ingest radius, the must-see ranking signal, the 2 km
image-verification rule), and the two tests are the cheapest regression net the
builder has.
