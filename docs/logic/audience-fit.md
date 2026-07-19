# Audience-fit logic — the short-path / consensus signal

**What it does:** for a city's top attractions, rate how much each is a
*consensus pick* for three traveller audiences. Stored as `attractions.audience_fit`
jsonb and read by the consumer short path. Source of truth for the judgment;
the agent applies it — no API. See [README](./README.md).

## Input (per attraction)
`{ id, name, category, iconic (bool), family_score, tagline, traveler_notes }`.
`iconic = true` when the place is one of the city's flagship must-sees.
`traveler_notes` = real matched insight texts (may be empty).

## Output (per attraction)
| field | type | meaning |
|---|---|---|
| `id` | int | echo |
| `families` | int 0-100 | consensus for families (with kids) |
| `couples` | int 0-100 | consensus for couples (romantic) |
| `friends` | int 0-100 | consensus for friends (social / nightlife / food) |
| `type` | enum | `universal` \| `family` \| `romantic` \| `social` \| `foodie` \| `cultural` \| `hidden_gem` \| `outdoors` — the dominant character |
| `why_he` | string | one short Hebrew clause |

The three audience scores are **independent** — a place can be high for several
or just one, and **near-0 for an audience it does not suit** (a red-light
district for families).

## Key judgment calls
- **Ground in the real `traveler_notes`** when present, plus the place identity.
- **Iconic must-sees (`iconic:true`)** — the city's flagship attractions (Tower
  of London, Colosseum, Eiffel Tower) are **TOP destinations for EVERY
  audience**; visitors of all kinds go there regardless of sub-taste. Score them
  **~85-100** for each audience UNLESS genuinely unsuitable (adults-only, a
  somber memorial for a light outing) — then score honestly.
- **Do not rank a minor local park / farm / garden above a world-famous
  landmark for families** just because it is playground-like: a castle,
  cathedral or great museum is a premier family outing too. Non-iconic pleasant
  spots stay in the mid range.

## How the score is USED (context, not something you output)
The consumer computes `consensus = worthiness × (fit/100)`, where
`worthiness = 0.10 + 0.28·travellerStrength + 0.28·wiki + 0.34·curation`
(curation = editor-must/must_see). The short path shows the top ~24 by consensus
among the audience-eligible (`fit ≥ 35`). So your `fit` IS the ranking signal.

## Runner
`python3 logic_agent.py audience pull <dest_id|all> [--limit N]` → candidate rows (top ~70/city) as JSON.
The agent applies this spec → `python3 logic_agent.py audience write <file.json>`.
