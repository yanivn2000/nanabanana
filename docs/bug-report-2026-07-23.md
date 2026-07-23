# Bug hunt — nanabanana / Yalle web app

**Date:** 2026-07-23 · **Scope:** recently-changed engine + trip UI · **Status: all 4 FIXED & verified** ✅

> **סיכום בעברית:** מצאתי **3 באגים ודאיים** ועוד אחד סביר — **וכולם תוקנו ואומתו מול השרת החי**. השניים הכי חשובים: (1) עריכה דטרמיניסטית ("סדר את היום" / הכפתורים המהירים) חישבה זמנים כאילו *הולכים ברגל* בין עצירות — קפיצה רחוקה חזרה להיות "3 שעות הליכה"; תוקן: אומת שקפיצה של 12 ק"מ נותנת ~45 דק' תחבורה במקום ~3 שעות. (2) "הוסף X ליום 3" / "הסר X מיום 2" התעלמו ממספר היום; תוקן: אומת ש"הסר X מיום 1" הסיר רק מיום 1.
>
> **אימות:** באג 1 — קפיצת 12 ק"מ = 95 דק' (שהייה + תחבורה), לא ~245. באג 2 — הסרה סקופ־ליום פגעה רק ביום המבוקש. באגים 3+4 — נתיבי arrange ורב-עירוני מחזירים 200 בלי שגיאות, טיול וינה+זלצבורג בונה 4 ימים עם טכניקות לכל עיר.

Static checks: `tsc --noEmit` is clean (the only errors are the known stale `.next/types/*.d 3.ts` duplicate-definition files from the file-sync tool — false positives, ignore).

---

## Bug 1 — Deterministic edits re-time days as pure WALKING, reviving the "3-hour walk" gap · **HIGH/MEDIUM**

**File:** [web/lib/revise-heuristic.ts:34](web/lib/revise-heuristic.ts:34) (in `retime`, used by both `arrangeDay` and `reviseHeuristic`)

The builder was deliberately fixed (commit `d1d329f` + `travelMinutes`) so a long hop between stops is timed as **public transit**, not walking:

```ts
// heuristic.ts:66  — correct
const transit = km <= 1 ? walk : 12 + (km / 22) * 60;
return Math.round(Math.min(walk, transit));
```

But the deterministic **edit** path never got that fix. `retime` still does:

```ts
// revise-heuristic.ts:34
if (nx && s.lat != null && nx.lat != null) clock += walkMinutes(haversineKm(s.lat, s.lng, nx.lat, nx.lng));
```

**Failure scenario:** A far-neighbourhood day (e.g. Greenwich morning → central afternoon, ~10 km apart) exists. The user clicks **"סדר את היום"** (arrange) or any quick-revise chip. `retime` runs and times the 10 km hop as `walkMinutes(10km)` ≈ **120–150 min of walking** instead of ~40 min transit. Every afternoon stop's clock is pushed hours late (e.g. a 15:00 stop shows 17:30), and the day looks broken again — the exact symptom that was fixed for the initial build.

**Fix direction (do NOT apply):** extract the transit-aware `travelMinutes` from `heuristic.ts` into a shared helper and use it in `retime` too, so build and edit share one travel model.

---

## Bug 2 — "add/remove X **to/from day N**" ignores the day number · **MEDIUM**

**File:** [web/lib/revise-heuristic.ts:122](web/lib/revise-heuristic.ts:122)–137 (add & remove branches)

The scope parse at line 84 (`const scope = dm ? [Number(dm[1]) - 1] : …`) is applied only to the lighten/shorten/intensify/rain loop (lines 97–120). The **add** and **remove** branches below ignore `scope` entirely:

- **Add** (122–133): finds the place, then picks `best` = the geographically **nearest day** and pushes it there — regardless of any "ליום N" the user wrote. The regex even strips the "ליום 3" clause (`(?:\s+ליום.*)?$`, line 93) and then throws that target away.
- **Remove** (134–137): `for (const d of days) d.stops = d.stops.filter(…)` — removes the matched name from **every day**, not the specified one.

**Failure scenario:**
- `"הוסף את המוזיאון הבריטי ליום 3"` → the museum is added to whichever day's centroid is closest to it, which may be day 1, not day 3.
- `"הסר את גשר המילניום מיום 2"` → if that stop also appears on day 4 (it shouldn't after dedup, but same-name variants can), it's removed from **both**; and even the intended single removal ignores that the user scoped it to day 2.

**Fix direction:** when `dm` matched (an explicit "יום N"), restrict the add-target and the remove-filter to `days[scope[0]]` instead of nearest-day / all-days.

---

## Bug 3 — Multi-city trips ignore ALL Brain techniques (dwell, avoids, season, lunch) · **MEDIUM**

**File:** [web/lib/heuristic.ts:208](web/lib/heuristic.ts:208)–227 (`buildMultiHeuristicItinerary`), called from [web/app/api/itinerary/route.ts:300](web/app/api/itinerary/route.ts:300)

`buildMultiHeuristicItinerary` has **no `opts` parameter** and calls the per-segment builder without one:

```ts
// heuristic.ts:216
const part = buildHeuristicItinerary(s.city, s.country, s.days, s.attractions, isFamily, perDay, walkPref);
//                                                                         ^ no buildOpts
```

Single-city builds pass the full `buildOpts` (dwell = the `visit_minutes` technique, `avoidCats`, `seasonFilter`, lunch timing, `samePlaceMeters`, `center`, …). Multi-city builds fall back to hardcoded defaults for **all** of them.

**Failure scenario:** A **family** trip Vienna → Salzburg won't apply `rules.avoid.families` (kid-inappropriate categories stay in), dwell times use `DWELL_DEFAULT` instead of each city's configured `visit_minutes`, and the lunch/day-start techniques are ignored. This also violates the standing "expose tunables" rule — an editor tunes a technique and multi-city silently doesn't honour it.

**Fix direction:** thread a `BuildOpts` (or a per-segment opts map, since techniques are per-destination) through `buildMultiHeuristicItinerary`, and build each segment's opts in the route's multi branch the way the single-city path does.

---

## Bug 4 — "סדר את היום" can silently drop a marked add that ranks outside the top 90 · **LOW/MEDIUM (plausible)**

**File:** [web/app/api/itinerary/route.ts:332](web/app/api/itinerary/route.ts:332) (arrange), pool built at lines 218 & 230

The arrange handler passes `attractions` as the pool. `attractions` is `rankByTaste(pool, taste, 90, …)` (line 218), i.e. **capped at 90** and reach-sorted. `arrangeDay` builds its `byId` map from exactly that list and, for any `addId` not found, **silently skips it** (`revise-heuristic.ts:67`).

The map's grey "add" markers come from `trip.leftOut` = the traveller's "כן" picks that weren't scheduled. Those picks are loaded into `pool` but `rankByTaste` truncates to 90, so a **low-taste "כן" pick** can appear as an addable grey marker yet be absent from the 90-item arrange pool.

**Failure scenario:** In a dense city (pool > 90), the user marks a low-ranked "כן" pick on the map and clicks "סדר את היום". The add is a no-op — the marker's pick never enters the day, with no error shown. (Marked as *plausible*: requires >90 candidates and a pick ranked past the cut; I did not reproduce it live.)

**Fix direction:** for arrange, resolve add ids against the full loaded pool (`pool`, or a targeted `attractionsByIds(addIds)`) rather than the 90-item taste-ranked slice.

---

### Notes / non-issues checked and cleared
- **Drag-and-drop `reorderStop` off-by-one** (TripView.tsx:437): traced against the drop-indicator logic (`dragSi > si ? top : bottom`) — the splice-remove-then-insert lands the stop on the indicated side in both directions. **Correct.**
- **`deleteStop` / `mutate` day collapse** (TripView.tsx:421): deleting a day's last stop filters the empty day and renumbers; `curIdx` clamps. Behaves sanely.
- Quick delete discards a stop without returning it to `leftOut` (unlike the map remove flow). Likely intended (discard vs. park), flagging only for awareness.
