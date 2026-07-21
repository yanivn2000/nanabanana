# The Brain — the deterministic trip engine

**Kind:** deterministic module that **specialises in building trips for Israelis**
and **never calls a paid AI**. Its intelligence lives in versioned, calibratable
data + code. Canonical code: `web/lib/brain/` (`policy.ts`, `critique.ts`),
`web/lib/cluster.ts` (the builder core), `/api/admin/brain-eval` (self-eval).

## Why
The consumer trip build must be free and get better over time without burning the
API budget ([[ai-cost-model]] / `route.ts` heuristic default). The Brain is that
free engine, made into a coherent, self-improving module.

## The two halves (generator + critic)
- **Builder** (generator): selects the audience-appropriate attractions and shapes
  them into tight, walkable, neighbourhood days — `clusterIntoDays` + audience
  ranking. See [day-clustering.md](./day-clustering.md), [neighborhoods.md](./neighborhoods.md).
- **Critic** (`critique.ts`): scores a built trip 0–100 on dimensions and raises
  specific issues. This is the Brain's **fitness function**.

Separation matters: the **editor calibrates the critic** (teaches it what "good"
means), and the **builder optimises toward the critic**. Every improvement is
measurable.

## Policy = the calibratable state (`policy.ts`)
DATA, not algorithm: dimension **weights**, **thresholds**, and per-audience
**Israeli travel preferences** (families / couples / friends — category leanings,
kid-friendliness, pace). "Learning" = tuning THIS FILE. Bump `BRAIN_VERSION` each
calibration.

## Critic dimensions (v1)
`walkability` (tight days) · `mustSee` (covers real must-sees) · `audienceFit`
(stops suit the segment, incl. family_score for kids) · `variety` (no long
same-category run) · `pace` (stops/day per audience) · `balance` (even days) ·
`coherence` (each day one area). Weighted → overall; a trip `needsWork` if score <
`QUALITY_BAR` or any CRITICAL issue fires.

## The improvement loop ("software test")
1. **Self-eval** (`POST /api/admin/brain-eval`): build family/couples/friends for
   each city (deterministic), critique each → a report (per-trip score, dims,
   issues) + summary (avg score, #needWork).
2. **Editor review** (admin, Phase 2): the editor sees the trips + self-critique,
   marks good/bad and adds notes — problems AND what worked. Stored as labels.
3. **Calibrate** (Phase 3): the report (self-critique + editor notes) is handed to
   a Claude Code session, which TUNES `policy.ts` (+ this doc) — weights,
   thresholds, per-audience prefs, or the critic's rules — and commits. No AI at
   runtime; the calibration is the human+agent step.
4. **Regression**: keep an editor-approved "golden set"; re-run the matrix after
   any policy change and confirm scores didn't regress. Approved trips can later
   seed a ready-made-trips library.

Over time this converges: the critic learns the editor's taste, the builder is
tuned to satisfy it, and the golden set guards against forgetting.

## Two books: Techniques (how-to-cook) + Recipes (cook book)
The editor's model (2026-07-20): the Brain is a **cook**. Two separate, editor-
transparent things feed it:
- 🍳 **Techniques** = the general "how to cook" rules that apply to EVERY trip
  ("don't over-salt" → "≤2 museums/day", day-enders last, season filter). Stored in
  `brain_principles` (supabase/phase16.sql), edited in the admin **👨‍🍳 טכניקות** tab.
- 📕 **Recipes** = the per-region dishes (the משבצות) — anchors + local rules +
  variants. (Cook-book table = next build; today's `trip_templates` is the frozen
  precursor.) See [[project_trip_modules]].

### Principles = TYPED rules (the two-sided contract)
Each principle is a `kind` from a fixed vocabulary (`lib/brain/rules.ts#RULE_KINDS`)
+ `params` (jsonb). This is the whole trick: the **editor** edits params with
dropdowns and reads `principleLabel()` (a Hebrew sentence); the **Brain** reads
`resolveBrainRules()` (typed values) and never parses free text. Kinds today:
`pace_stops`, `max_type_per_day`, `active_anchor_required`, `day_ender_last`,
`season_filter`, `avoid_category` (supports keyword pseudo-types via
`traits.stopMatchesType`, e.g. `heavy_history`, `active`), and `custom` (advisory —
transparent but not auto-applied). Adding a technique = add a kind here + honour it
in the builder/critic.

**How the Brain obeys:** `route.ts` + `brain-eval` call `brainRulesForDest(destId)`
→ `resolveBrainRules(principles)` merges enabled global+city principles over the
policy defaults → a `BrainRules` object passed to `buildHeuristic/CarBaseItinerary`
(season/avoid pool filters, day-ender + max-type day ordering, pace) and
`critiqueTrip` (active-anchor + max-type flags). On/off techniques DEFAULT OFF and
are switched on by an enabled principle, so toggling one off in the editor really
turns the behaviour off. Digested editor notes are seeded as principle rows linked
back via `source_note_id` (badge "מהערה"). Verified: toggling `season_filter` off
makes the winter Königssee ice arena reappear in a July Salzburg build.

## Calibration findings (append here each round)
- **v1.3.0** (2026-07-20, editor call): the real audience axis is WITH KIDS vs
  WITHOUT, not families/couples/friends. Dropped `friends`; merged couples+friends
  into `adults` (couple-vs-friends is a soft taste sub-signal, not a hard audience).
  `Audience = "families" | "adults"`. The raw `audience_fit` JSON keeps its 3 fine
  sub-scores (the AI's judgment) — the Brain maps them via `audienceFitScore()`
  (families→families, adults→max(couples,friends)); no data migration. Kids model is
  now primarily a NEGATIVE filter (a young child follows the parents, so "not
  suitable for kids" — heavy_history/nightlife/bar — matters more than "designed for
  kids"), plus the soft one-active-anchor/day. Age is already stored per kid
  (`profile.kids[].age`) → ready for step 2 (young-follows-parents vs teens-have-wants).
  Consumer already keyed on `isFamily = profile.kids.length>0`, so no profile change.
- v1.0.0 (2026-07-20, first self-eval, cities London/Rome/Barcelona): avg 79/100,
  0 needWork. `variety` scores low (46–69) because it penalises runs of the raw OSM
  `category`, which is coarse ("attraction" covers most landmarks) — variety should
  use a finer signal (audience_fit.type / taste tags), not raw category. `balance`
  is often low (41) — measured by stop-count, which over-penalises a tight 6-stop
  day vs a spread 4-stop day of equal duration. First calibration candidates.
- **v1.1.0** (2026-07-20, self-calibration by Claude Code — no editor input yet):
  fixed both v1.0.0 findings. (1) `variety` now runs on `audience_fit.type` (the
  experience type) instead of OSM `category`; (2) `balance` now measures per-day
  TIME (visit+walk minutes) std, not stop count (`balanceTimeStdMax=110`). Re-ran
  the same matrix: avg **79 → 89**, variety dim ~46–69 → **98**, balance ~41 → **91**,
  while walkability/mustSee/audienceFit held (91/95/85) — no regression. Demonstrates
  the loop: identify → fix policy/critic → re-run → measure → version-bump. NOTE:
  these were agent-identified measurement bugs; the FIRST real editor-driven
  calibration (👍/👎 + notes → policy tuning) is still pending.
- **v1.2.0** (2026-07-20, FIRST editor-driven calibration — digested 3 `brain_notes`
  written by the editor from Salzburg trip pages). New calibration channel: editor
  writes build-policy notes on any trip page → I digest them into policy/traits. The
  three notes + what changed:
  1. *"3 hour-long culture stops = a boring family day; Israeli kids need one ACTIVE
     thing (cable-car/toboggan/gorge/pool)"* → `PACE_STOPS.families` 4→5; new
     `lib/brain/traits.ts#isActiveAnchor`; critic now flags a family day (≥3 stops)
     with no active anchor and docks audienceFit −8. (Builder enforces this via the
     flag + higher pace, NOT a ranking boost — a boost distorted must-see coverage.)
  2. *"water/adventure parks are day-ENDERS — schedule them last"* →
     `traits.reorderDayEnders` pushes water/toboggan/amusement stops to the end of a
     day, in both the in-city and car-day-trip builders.
  3. *"the ice arena is winter-only; season is a required build input"* →
     `traits.isInSeason` filters winter-only (ice/ski) vs summer-only (water) places
     by the trip's month; wired through `route.ts` (body.month) and brain-eval
     (default month 7). Verified: the Königssee ice arena no longer appears in a
     July build.
  NEW findings this round (next candidates, NOT yet done): (a) car_base "in-city"
  days can be thin — "in-city" spans ≤18km but the walk-clusterer's time budget fills
  after 2 far-apart stops; (b) the active anchor is FLAGGED but not force-injected
  into the day; (c) a family day pulled in the Obersalzberg/Hitler documentation
  museum — needs an audience-appropriateness avoid for heavy-history sites on family
  trips.
