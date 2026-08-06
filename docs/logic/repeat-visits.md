# Repeat visits — one place, one slot per trip

**Status: this is the engine's behaviour today, deliberately documented rather
than changed.** Raised by the owner 2026-08-06: *"זה מציף באג שלא ניתן לבקר
באותו מקום פעמיים (נגיד פעמיים ללכת לכיכר נבונה).. אולי זה נכון אבל רק צריך
לתעד את זה"*.

## The rule

**The engine never schedules the same attraction twice in one trip.** Not on two
days, not twice on one day. If the Colosseum is a morning visit on day 2, the
engine will not also place it as a lit night stop on day 4.

## Where it is enforced

Four independent mechanisms, all in play at once. Any one of them alone would be
enough for the common case; together they also catch the messy ones (the same
place mapped at two OSM nodes, a park with two entrances).

| # | Mechanism | Code | What it catches |
|---|---|---|---|
| 1 | `usedIds` — a set of every attraction already picked, shared across all days | `web/lib/heuristic.ts` (`usedIds`, ~line 346) | the direct case: a pick is removed from the pool the moment it is used |
| 2 | day partition — `clusterIntoDays` assigns each attraction to exactly one day | `web/lib/cluster.ts` | an attraction cannot be in two days' candidate lists to begin with |
| 3 | `dropSamePlace` — within one day, two stops closer than 90 m collapse to the better one | `web/lib/cluster.ts:118` | the same square arrived at from two directions |
| 4 | `dedupeAcrossDays` — across days, <120 m apart, or the same name within 1.5 km | `web/lib/cluster.ts:144` | one place mapped at two far nodes (a big park's two ends) |

Mechanisms 3 and 4 both **skip `parent_id != null`** — a curated sub-attraction
of a complex is never an accidental duplicate. The Parthenon and the Erechtheion
sit 40 m apart and are both the point of going up.

## The two deliberate exceptions

| What | Limit | Why |
|---|---|---|
| Evening streets (`streets.evening`) | up to **2 nights per trip** | `evUses` in `heuristic.ts`. A city may have fewer curated evening spots than the trip has nights, and returning to a good square on a second evening is normal behaviour — but five nights in a row reads as a bug, not a recommendation. |
| Night pass-by icons (`attractions.night_passby`) | **1 per trip** | `iconsLeft`, the `night_passby` technique. A floodlit landmark is a highlight; repeating it makes it a habit. |

A night icon is also excluded when it is already in the trip as a daytime visit
(it is in `usedIds`). This is why Rome, Athens, Florence and Paris rarely get a
night pass-by: their icons are already daytime must-sees.

## What the traveller can still do

The rule binds the **engine**, not the person. On the trip page,
`insertAttraction` and `addManualPlace` (`web/app/trip/[id]/TripView.tsx`) have
**no duplicate guard** — "הוסף מקום ליום זה" will happily add Piazza Navona to a
second day. That is intentional: the traveller who wants the square by day and
again by night can say so.

"יותר אטרקציות" is the one exception on that page: it passes the already-used
ids to the server so a top-up never re-offers something the trip already has.

## Why it is left this way

A second visit is a real travel pattern (a square by day and by night, a market
in the morning and the same street for dinner), but it is a *deliberate* choice,
not a default. An engine that could repeat places would repeat them for the
wrong reason — a proximity slot to fill, a thin pool in a small city — and the
traveller would read it as the engine forgetting where it had already sent them.
Filling a gap with somewhere new is almost always the better trip.

## If we want to change it

The natural shape is a technique (`repeat_visits`) with a per-place cap
defaulting to 1, applied at `usedIds` and exempted in `dedupeAcrossDays`. The
harder half is not the cap but the *reason*: a second visit only makes sense when
the two slots differ in kind — a market at 09:00 and its street at 20:00, a
square by day and lit at night. Without that test, a cap of 2 just produces
duplicates. Time-of-day is now in the data (`attractions.time_of_day`,
`night_passby`), so the test is buildable: allow a repeat only when the second
slot is a different part of the day AND the place is valid in both.
