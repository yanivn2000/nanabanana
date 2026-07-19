# Routing logic — getting from A to B

**Kind:** deterministic (pure code — no AI, no paid API). Canonical code:
[`web/lib/geo.ts`](../../web/lib/geo.ts), [`web/lib/db.ts`](../../web/lib/db.ts)
(`recordWalkEdges`/`getEdges`), DB: `attraction_edges`, `destinations.transit_synced_at`.

## Why this exists / the rule
A trip must tell the traveller **how** to move between stops (walk / tram / metro),
**planned in advance**. Two hard constraints shaped every decision:

1. **No paid routing API.** Same rule as the rest of the project — we own the data.
2. **Google Directions ToS forbids storing/pre-computing results.** They must be
   fetched live and shown on a Google map. So Google is the *wrong* tool for the
   planning step and the *right* tool for day-of live navigation.

→ **Split:** we compute & store the pre-planned leg ourselves (deterministic);
the "נווט" button deep-links to Google/Waze for live navigation (deep-linking is
allowed where storing is not).

## The walk model (exact-ish, permanent)
`walkMinutes(km)` = `km × 12.5 × 1.3`, min 1.
- 12.5 min/km ≈ 4.8 km/h walking speed.
- ×1.3 because real streets are longer than the straight-line haversine distance.
Deterministic and **permanent** — streets don't move.

## The transit model (estimate → real later)
`estimateLeg()` transit placeholder = `round(11 + (km / 20) × 60)` minutes:
- **11 min fixed overhead** = walk-to-stop + wait (½ average headway) + walk-from-stop.
- line-haul at ~20 km/h.
This is an **honest placeholder**, clearly labelled "~", until real GTFS/OTP data
replaces it with actual line names + transfers. It exists so the walk-vs-transit
*decision* is sensible today.

## Walk vs transit decision
Transit's ~11-min fixed overhead means it only wins once the walk is long enough.
The traveller's **`walkPref` (1–5)** sets the threshold via `WALK_PREF_KM`
{1:0.5, 2:1.0, 3:1.5, 4:2.5, 5:4.0} km. `estimateLeg(a,b,walkPref)` returns the
recommended mode + the alternative when it's a genuine toss-up (e.g. Amsterdam
centre → Albert Cuyp ~1.9 km: tram ~17 min *or* walk ~31 min → show both).

## The edge graph (`attraction_edges`)
Nodes = attractions (stable ids + lat/lng). Edges = a computed leg, keyed
`(from_id, to_id)` (directed; walk is symmetric so both directions are stored).
Columns: `walk_m, walk_min` (real, permanent) · `transit_mode, transit_line,
transit_min, transit_transfers` (filled later from GTFS) · `recommended, source,
computed_at, transit_checked_at`.

**Fills in from real trips:** every build records the walk bridges between its
consecutive stops (`recordWalkEdges`, fire-and-forget in the itinerary route),
keyed on attraction ids, reused forever. Walk math is deterministic so this is
essentially free; the cache matters most when transit (expensive) lands.
Per-city coverage + last transit sync are shown in the admin cities tab
(`🌉 edge count`, `🚇 transit-sync recency`). `markTransitSynced(destId)` stamps a
city after a GTFS fill.

## When to change / extend
- **Real walk times:** swap `walkMinutes` for OSRM (self-host) or OpenRouteService
  (free tier) — same edge table, `source='osrm'`.
- **Real transit:** OpenTripPlanner / Navitia over open **GTFS** per covered city →
  fills `transit_*`, then call `markTransitSynced`. Refresh seasonally (timetables
  change) — walk never needs refreshing.
- Keep the deep-link live-nav split regardless.

## Known gaps
- Transit is an estimate until GTFS is wired.
- Multi-city builds don't record edges yet (only the single-city generate path).
