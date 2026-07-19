# AI logic — the source of truth

These files are the **written, version-controlled logic** for the AI-judgment
steps in NanaBanana (enrichment, audience-fit, insight matching). They are the
*source of truth* — not a script's buried prompt, not a chat session's memory.

## Why this exists
The intelligence for these steps must not live only inside one agent session
(fragile, can't be reviewed, can drift). It lives here: readable by a human,
readable by any Claude session, tracked in git (backed up, diffable, never
silently lost), and **updated over time by the agent** as we learn.

## The rule: the agent is the intelligence, NOT a paid API
We do **not** call the Anthropic API for these steps (it bills credits). Instead,
a Claude session **reads the relevant spec and applies the judgment itself**, and
thin runner scripts do only the database I/O. No API key, no credit burn.

## How to run a step (any session, including a fresh one)
Example — enrich the pending attractions of city 25:

1. **Pull** the work (DB only):
   `python3 logic_agent.py enrich pull 25 --limit 60 > /tmp/pending.json`
2. **Apply the spec yourself.** Read `docs/logic/enrichment.md`, read
   `/tmp/pending.json`, and produce the enriched JSON (one object per id, matching
   the spec's output table) → write it to `/tmp/enriched.json`.
3. **Write** the results (DB only):
   `python3 logic_agent.py enrich write /tmp/enriched.json`

Same pattern for `audience` (see `audience-fit.md`) and `matching`.

## The steps
| spec | what it produces | stored in |
|---|---|---|
| [enrichment.md](./enrichment.md) | Hebrew name, family_score, must_see, tips, tagline, best-time… | `attractions.*` |
| [audience-fit.md](./audience-fit.md) | `{families, couples, friends, type}` 0-100 | `attractions.audience_fit` |
| [matching.md](./matching.md) | which attraction an insight's place refers to (or none) | `insights.attraction_id` |

## Keeping it current
When we refine a rule (e.g. "iconic must-sees score high for every audience"),
update the spec here in the same change — the spec, not the code, is canonical.
The legacy API scripts (`enrich.py`, `cons_pipeline.py`, `match.ts`) still encode
the same logic for reference, but the **agent + spec** path above is the one we use.
