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

## Calibration findings (append here each round)
- v1.0.0 (2026-07-20, first self-eval, cities London/Rome/Barcelona): avg 79/100,
  0 needWork. `variety` scores low (46–69) because it penalises runs of the raw OSM
  `category`, which is coarse ("attraction" covers most landmarks) — variety should
  use a finer signal (audience_fit.type / taste tags), not raw category. `balance`
  is often low (41) — the clusterer makes uneven day sizes; consider a balancing
  pass. First calibration candidates.
