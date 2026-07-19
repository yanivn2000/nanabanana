# Day-clustering logic — tight, walkable days

**Kind:** deterministic (pure code — no AI, no paid API). Canonical code:
[`web/lib/cluster.ts`](../../web/lib/cluster.ts) (`clusterIntoDays`). Used by the
heuristic builder ([`web/lib/heuristic.ts`](../../web/lib/heuristic.ts)) directly,
and injected into the AI prompt as a hint ([`web/lib/ai.ts`](../../web/lib/ai.ts)
`proximityBlock`).

## Why this exists
Proximity between attractions is a real value in trip-building: if you're 100 m
from a place, popping in costs almost nothing, so a tight day fits MORE stops and
the walking is pleasant. The old builder sliced the value-ranked list into days
(`pool.slice(idx, idx+perDay)`) — which scattered each day across the city. This
replaces that with geographic clustering.

## The algorithm: route-first, cluster-second
1. **Candidates** = the top `days × 8` value-ranked places (input order = value).
2. **Tour** = one nearest-neighbour + 2-opt walking path through the candidates,
   started from the **most-central** candidate (min total distance to the others),
   so the tour radiates outward.
3. **Cut** the tour into `days` contiguous slices by a per-day **time budget**
   (`visit + travel`). A new day starts fresh (its first stop has no travel cost).
4. **Order** each day as a short walking path (NN + 2-opt).

Driving structure by **geography, not value rank** is the key robustness choice
(see rejected alternative below): it produces balanced, tight days and naturally
drops the sparse periphery — so a dense cluster is always preferred and an isolated
place has to sit on the natural route to make the cut.

Measured on London top-50 (3 days): intra-day walking **~851 → ~73 min (>90% less)**,
balanced ~5/5/5 days.

## Pass B — opportunistic "free gems"
After each day's route exists, sweep the **full** city pool (not just the top
picks) and pull in any place within **`FREE_DETOUR` = 4 min** off the path, while
the day still has budget, capped at **`FREE_MAX_PER_DAY` = 3**. A near-duplicate
guard (`isDuplicate`, ≤1 min + name containment) stops twin DB rows (e.g. "Big Ben"
/ "Elizabeth Tower") both getting in. This is the "we're already here, let's pop
in" delight — verified pulling the Courtauld Gallery (value rank 44) onto a London
day 2 min off-path. Requires a wide build pool — the itinerary route ranks **90**
(not 50) attractions so the long tail exists.

## walkPref
Scales the day budget: `budget = dayMinutes × (1 + (walkPref − 3) × 0.11)` — a
"walk everything" traveller (5) gets longer days that fit more; "minimise walking"
(1) gets shorter, tighter ones. `dayMinutes` from the pace (`perDay × 84`).

## Key parameters (current)
| name | value | meaning |
|---|---|---|
| `CANDIDATES_PER_DAY` | 8 | top-value places seeding the tour |
| `FREE_DETOUR` | 4 min | how far off-path a free gem may sit |
| `FREE_MAX_PER_DAY` | 3 | cap on free gems per day |
| `VISIT_*` | 40/75/150 | per-stop visit minutes (clamp / default) |
| build pool | 90 | attractions passed to the builder (long tail for B) |

## Rejected alternative — full prize-collecting (value − λ·travel)
We tried seeding days and adding places by `value − λ·travel` to encode "isolated
only if worth it". It **failed on real data**: it seeds days by value RANK, so a
mis-ranked outlier (Parliament Hill was London's #1 for couples) wastes an entire
day on itself. Route-first ignores the misranking for structure and is robust.
Route-first still delivers the *spirit* of value-vs-distance (dense preferred,
isolated dropped). The literal "isolated-but-special earns its own day" is handled
by the neighbourhood layer instead — see [`neighborhoods.md`](./neighborhoods.md).

## Known gaps
- Areas currently only LABEL built days (see neighborhoods.md), they don't yet
  SEED an isolated-but-special area day.
- No "two half-days" (neighbourhood A morning + B afternoon) mode.
