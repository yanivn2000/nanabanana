@AGENTS.md

# The Brain — techniques, not hardcoded constants

The trip engine ("המוח") reads its tunable rules from the `brain_principles` table at
**build time** (`brainRulesForDest` → `resolveBrainRules`; no cache — an edit takes
effect on the next build), NOT from constants. The admin **👨‍🍳 טכניקות** tab lets the
editor edit them live, grouped by tier.

**RULE — whenever you add or change a value an editor could reasonably want to tune
(pace, thresholds, distances, times, weights, budgets, counts), expose it as a
TECHNIQUE. Do NOT leave it hardcoded in the engine.** Otherwise the system drifts to
half-transparent. Only genuine algorithm internals (clustering, scheduler loop,
physics formulas, seed counts) stay as constants — tag each `// engine — not a technique`.

**A technique = data + code**, added in 3 steps (see `docs/logic/techniques.md`):
1. **Declare** the `kind` in `lib/brain/rules.ts#RULE_KINDS` — title, a clear-Hebrew
   `help` line (explain what the value DOES), typed `params`, and a group in `KIND_GROUP`.
2. **Resolve** it in `resolveBrainRules` — map params → a field on `BrainRules` with a
   default from `policy.ts`. The Brain reads TYPED values, never free text.
3. **Honor** it — the builder/critic reads that `BrainRules` field and changes behaviour.

The admin can add/edit ROWS for kinds the code already knows; a brand-NEW kind needs
those 3 edits (you, not the admin) — deliberate, so the deterministic Brain can always
execute a rule without AI parsing. The `custom` kind is the free-text escape hatch:
advisory only, digested into code manually.

Guard against drift: `node web/scripts/audit_techniques.mjs` lists engine constants and
flags any that aren't classified (technique-backed or explicitly engine-internal).
