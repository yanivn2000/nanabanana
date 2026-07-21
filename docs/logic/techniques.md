# Techniques — how the Brain's tunables stay transparent

The Brain is an ENGINE (deterministic algorithms) that runs according to TECHNIQUES
(the editor-tunable decisions). The whole point: no "policy number" hides in the
engine as a bare constant. This doc is the process that keeps it that way.

## The invariant: a technique = DATA + CODE
- **Data** — a row in `brain_principles` (`kind` + `params` jsonb + scope/enabled).
  This is what the admin **👨‍🍳 טכניקות** tab adds and edits.
- **Code** — for each `kind`: a declaration, a resolver, and a honor-site. The Brain
  reads TYPED values (`kind`+`params`), never free text — so it can execute a rule
  deterministically, no AI parsing.

Consequence (answering "where's the code behind a technique?"): the admin manages
**instances of kinds the code already knows**. A brand-new *kind* is a small code
change — you can't invent new engine behaviour from the admin alone. That's on
purpose.

## Read timing
`brainRulesForDest(destId)` runs at **build time** in `app/api/itinerary/route.ts`
and `app/api/admin/brain-eval/route.ts` — a fresh DB read, no cache. So editing a
technique in the admin takes effect on the very next build.

## How to add a technique (3 steps)
1. **Declare** — add the `kind` to `lib/brain/rules.ts#RULE_KINDS`: `title`, a
   clear-Hebrew `help` (explain what the value DOES, not just names it), typed
   `params` (audience | exptype | number | text | time | dimension), and its group in
   `KIND_GROUP` (which tier it shows under).
2. **Resolve** — add a field to `BrainRules` (default from `policy.ts`) and a case in
   `resolveBrainRules` mapping `params` → that field.
3. **Honor** — read the `BrainRules` field where the behaviour lives (builder
   `lib/heuristic.ts` via `BuildOpts`, clusterer `lib/cluster.ts`, day-trips
   `lib/daytrips.ts`, or critic `lib/brain/critique.ts` via `ctx.rules`). Fall back to
   the policy default so an empty table behaves like before.
4. Seed a default row so it's visible/editable, and verify the loop (edit in admin →
   behaviour changes).

On/off techniques (season_filter, day_ender_last) default OFF in `resolveBrainRules`
and are switched ON by an enabled principle — so toggling one off really turns it off.

## The boundary: technique vs engine
- **Technique** (must be exposed): any number you'd argue about in a team meeting —
  pace, thresholds, distances, times, budgets, weights, counts.
- **Engine** (stays a constant, tagged `// engine — not a technique`): the clustering
  algorithm (NN tour + 2-opt, k-means), the scheduler loop, physics formulas
  (walk/transit/drive speeds), tour seed counts. An editor shouldn't tune a 2-opt.

## Anti-drift
Standing rule (also in `web/CLAUDE.md`): when adding or changing a tunable value,
expose it as a technique in the same change — never leave it hardcoded, or the system
becomes half-transparent. `node web/scripts/audit_techniques.mjs` lists the engine
files' constants and flags any that are neither technique-backed nor explicitly
classified as engine-internal — run it after touching the engine.

Current tiers (see `brain.md` for the full kind list): קהל וסינון · תחושת-יום ·
מבנה-הטיול · כיול-הביקורת · הערות.
