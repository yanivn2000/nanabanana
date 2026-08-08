# What actually shapes a trip — audit 2026-08-08

Written after the owner asked whether picking "ממש קרוב" on the distance slider
was what broke a Salzburg build. It was not — but the question exposed that the
slider reached nothing, and the obvious follow-up was: *which other controls are
decorative?* This is the answer, measured rather than read: every input was
tested by building the same city twice with a fixed seed (so the best-of-N
lottery cannot mask a difference) and comparing the stop lists.

Re-run the method any time a control is added:

```
POST /api/itinerary {"city":"Vienna","days":4,"seed":42}            → baseline
POST /api/itinerary {"city":"Vienna","days":4,"seed":42,"X":...}    → compare
```

A fixed `seed` is what makes this valid. Without it every build differs anyway
and nothing can be concluded.

## Shapes the trip ✅

| Input | How | Evidence |
|---|---|---|
| `isFamily` / `audience` | family ranking of the fill, `paceStops.families`, kids-anchor rules | 15 / 23 stops changed |
| `pace` | `paceBudget` → day minutes + max stops | calm `[6,5,5]` vs normal `[10,8,8]` |
| `walkPref` | day radius, cluster tightness | 7-8 stops changed at 1 vs 5 |
| `taste` | `rankByTaste` over `attractions.taste_tags` | nature/art/culture each moved ~11 stops |
| `days`, `selection` (❤ picks), `streetIds`, `areaGroups`/`areaIds` | the pick-driven path — the marks ARE the trip | covered by the round-robin stress test |
| `driveHours` | car day-trip cap (`maxDriveMin`) | **wired 2026-08-08** — was decorative before |
| `hotels` | resolves WHICH destination when the city is ambiguous | day re-anchoring happens later, on the trip page |

## Collected but does NOT shape the trip ❌

| Input | Where it goes | Note |
|---|---|---|
| `budget` | `profileText` → AI prompt only, and AI is off | asked in the profile editor; now labelled as not affecting the picks |
| `adults` | party size for the price estimate | never reaches the builder |
| `lodging` | `profileText` only | not asked anywhere in the current UI |
| `accessibility`, `dietary` | typed in `FamilyProfile`, never collected, never used | **do not surface these until they work** — a traveller who says "כיסא גלגלים" and gets nothing is worse served than one never asked |
| `dislikes` | `deriveTaste` subtracts them into `taste` | works *through* taste; no direct path |
| `interests` | removed from the engine 2026-08-04 (build became pick-driven); the client kept sending it with a comment claiming it governed | payload + type removed 2026-08-08 |

## Wired but nearly inert ⚠️

`month` → `isInSeason` (technique `season_filter`, enabled globally). The filter
is keyword-based (`WINTER_RX` / `SUMMER_RX` over the name/subcategory) and
recognises **220 of 13,289 shown places** — 74 winter, 146 summer. Those rarely
rank into a build, so August and January produce identical trips in Vienna,
Budapest, Salzburg and Crete.

Meanwhile `attractions.best_season` is filled on 10,501 rows and the filter never
reads it. Wiring it is NOT a quick win: the values look auto-generated (`all`
16k, `spring` 8.5k, `autumn` 69, `winter` 33), so trusting them would wrongly
drop huge numbers of places. Fix the data first, then the filter.

## The rule this audit exists to enforce

**A control the traveller can see must change the trip, or say that it doesn't.**
Both failures found here — the distance slider and the budget selector — looked
like working features for weeks. When adding an input, add its row to the table
above and prove it with the seeded diff.
