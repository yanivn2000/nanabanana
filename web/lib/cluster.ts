// Proximity day-clustering — turn a value-ranked pool of attractions into
// geographically tight days, so each day is a walkable neighbourhood rather than
// a zig-zag across the city, and the walking itself becomes pleasant.
//
// Day STRUCTURE uses "route-first, cluster-second" (deterministic, no routing API
// / AI): build one good walking tour through the top candidates (nearest-neighbour
// + 2-opt) starting from the most-central one, then cut the tour into `days`
// contiguous slices by a per-day time budget. Driving structure by GEOGRAPHY (not
// value rank) keeps it robust to a mis-ranked outlier, produces balanced days, and
// naturally DROPS the sparse periphery — so a dense cluster is always preferred and
// an isolated place has to sit on the natural route to make the cut.
//
// Then an OPPORTUNISTIC "free gems" pass (B) sweeps the FULL city pool — not just
// the top picks — and pulls in anything a couple of minutes off the path: the nice
// statue, the café street, the building that survived the war. They cost almost no
// travel, so they earn a slot cheaply — the "we're already here, let's pop in"
// delight.
import type { Attraction } from "./db";
import type { Day } from "./trip-types";
import { haversineKm, walkMinutes } from "./geo";
import { DWELL_DEFAULT, dwellMinutes, type DwellCfg } from "./brain/traits";

// A neighbourhood, trimmed to what day-labelling needs.
export type AreaLite = {
  name_he: string | null; lat: number; lng: number;
  radius_m: number | null; gateway_he: string | null;
};

// Tag each built day with the neighbourhood it mostly explores, and — for areas
// out of the city centre — how to get there ("DLR to Cutty Sark"). Purely a label
// pass over an already-built itinerary, so it works for both the heuristic and AI
// plans. Matches a day to the nearest area whose centroid is within its extent.
export function annotateDaysWithAreas(
  days: Day[], areas: AreaLite[], center: { lat: number; lng: number }
): void {
  if (!areas.length) return;
  for (const day of days) {
    if (day.dayTrip) continue; // car day-trips carry their own far-area label
    const pts = day.stops.filter((s) => s.lat != null && s.lng != null);
    if (!pts.length) continue;
    const clat = pts.reduce((s, p) => s + (p.lat as number), 0) / pts.length;
    const clng = pts.reduce((s, p) => s + (p.lng as number), 0) / pts.length;
    let best: AreaLite | null = null, bestKm = Infinity;
    for (const a of areas) {
      const km = haversineKm(clat, clng, a.lat, a.lng);
      // within the area's extent (+600m slack) and the closest such area
      if (km * 1000 <= (a.radius_m ?? 800) + 600 && km < bestKm) { bestKm = km; best = a; }
    }
    if (!best) continue;
    day.area = best.name_he ?? undefined;
    // Gateway framing only when the neighbourhood is genuinely out of the centre
    // (> 2.5 km) — you don't tell someone to "take the train" to where they are.
    if (best.gateway_he && haversineKm(best.lat, best.lng, center.lat, center.lng) > 2.5) {
      day.gateway = best.gateway_he;
    }
  }
}

const FREE_DETOUR = 4;          // minutes off-path a "free gem" may sit (B)
const FREE_MAX_PER_DAY = 3;     // don't drown a day in minor gems

// How long the traveler spends AT a place (minutes) — by what the place IS
// (dwellMinutes), not OSM's unreliable duration. Config is a technique.
const visitMin = (a: Attraction, dwell: DwellCfg = DWELL_DEFAULT): number => dwellMinutes(a, dwell);

function walkBetween(a: Attraction, b: Attraction): number {
  return walkMinutes(haversineKm(a.lat as number, a.lng as number, b.lat as number, b.lng as number));
}

// Nearest walk-minutes from x to any stop already in the day.
function nearestMin(x: Attraction, day: Attraction[]): number {
  let m = Infinity;
  for (const s of day) { const d = walkBetween(x, s); if (d < m) m = d; }
  return m;
}

// Total walking (minutes) along a day's ordered stops.
export function dayWalkMinutes(day: Attraction[]): number {
  let sum = 0;
  for (let i = 0; i < day.length - 1; i++) sum += walkBetween(day[i], day[i + 1]);
  return sum;
}

// Drop "same place" stops within a day — two things < ~90m apart are one visit
// (a landmark and its own hill/square/garden, e.g. Hohensalzburg + Festungsberg).
// Keeps the more valuable of the pair so the fortress wins over the hill.
const stopWorth = (a: Attraction) =>
  (a.must_see === 1 ? 1000 : 0) +
  Math.max(a.audience_fit?.families ?? 0, a.audience_fit?.couples ?? 0, a.audience_fit?.friends ?? 0);
export function dropSamePlace(day: Attraction[], minMeters = 90): Attraction[] {
  const kept: Attraction[] = [];
  for (const a of day) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) { kept.push(a); continue; }
    const i = kept.findIndex((k) => Number.isFinite(k.lat) && Number.isFinite(k.lng) &&
      haversineKm(a.lat as number, a.lng as number, k.lat as number, k.lng as number) * 1000 < minMeters);
    if (i === -1) kept.push(a);
    else if (stopWorth(a) > stopWorth(kept[i])) kept[i] = a; // keep the better of the two, in place
  }
  return kept;
}

// Same as dropSamePlace but ACROSS the whole trip — a place (or a sub-feature of one
// complex: the Tower + its White Tower + Crown Jewels, St Peter's + its dome, the
// Louvre pyramid landing on two different days) must appear ONCE. Distance-only so it
// stays safe: genuinely distinct-but-adjacent sights (Tower + Tower Bridge ~350m,
// Upper + Lower Belvedere ~500m) sit outside the radius and both survive. Keeps the
// higher-worth entry (the whole "Tower of London" beats "White Tower").
// Token-sorted name key so word-order variants of one place ("St James Park" /
// "Park St James") collapse to the same key.
const normName = (a: Attraction) => (a.name_he || a.name_en || "")
  .toLowerCase().replace(/^ה/, "").split(/\s+/).filter(Boolean).sort().join(" ");
export function dedupeAcrossDays(days: Attraction[][], minMeters = 120): Attraction[][] {
  const kept: { a: Attraction; d: number; i: number; n: string }[] = [];
  const out: Attraction[][] = days.map(() => []);
  days.forEach((day, di) => {
    for (const a of day) {
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) { out[di].push(a); continue; }
      const nm = normName(a);
      const hit = kept.find((k) => {
        const m = haversineKm(a.lat as number, a.lng as number, k.a.lat as number, k.a.lng as number) * 1000;
        // same spot, OR the SAME named place mapped at two far nodes (a big park's
        // ends) that would otherwise show up on two different days.
        return m < minMeters || (nm.length >= 3 && nm === k.n && m < 1500);
      });
      if (!hit) { out[di].push(a); kept.push({ a, d: di, i: out[di].length - 1, n: nm }); }
      else if (stopWorth(a) > stopWorth(hit.a)) { out[hit.d][hit.i] = a; hit.a = a; } // upgrade in place, drop this one
      // else: silently drop the duplicate
    }
  });
  return out;
}

// 2-opt: reverse segments while it shortens the path (undoes crossings).
function twoOpt(path: Attraction[]): Attraction[] {
  for (let pass = 0; pass < 5; pass++) {
    let improved = false;
    for (let i = 1; i < path.length - 1; i++) {
      for (let k = i + 1; k < path.length; k++) {
        const a = path[i - 1], b = path[i], c = path[k], d = path[k + 1];
        const before = walkBetween(a, b) + (d ? walkBetween(c, d) : 0);
        const after = walkBetween(a, c) + (d ? walkBetween(b, d) : 0);
        if (after + 0.001 < before) {
          let lo = i, hi = k;
          while (lo < hi) { const t = path[lo]; path[lo] = path[hi]; path[hi] = t; lo++; hi--; }
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return path;
}

// Greedy nearest-neighbour path from `start`.
function nnPath(items: Attraction[], start: Attraction): Attraction[] {
  const remaining = items.filter((x) => x.id !== start.id);
  const path = [start];
  let cur = start;
  while (remaining.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = walkBetween(cur, remaining[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    cur = remaining.splice(bi, 1)[0];
    path.push(cur);
  }
  return path;
}

export const orderPath = (stops: Attraction[]): Attraction[] =>
  stops.length <= 2 ? stops : twoOpt(nnPath(stops, stops[0]));

// Is `x` effectively the same place as something already placed? Guards against
// near-duplicate DB rows (e.g. "Big Ben" / "Elizabeth Tower") sneaking in as a
// "free gem" 0 minutes away from their twin.
function isDuplicate(x: Attraction, stops: Attraction[]): boolean {
  const nx = (x.name_he || x.name_en || "").toLowerCase();
  for (const s of stops) {
    if (walkBetween(x, s) <= 1) {
      const ns = (s.name_he || s.name_en || "").toLowerCase();
      if (ns.includes(nx) || nx.includes(ns)) return true;
    }
  }
  return false;
}

export type ClusterResult = { days: Attraction[][]; leftOut: Attraction[] };

export function clusterIntoDays(
  poolIn: Attraction[], days: number,
  opts: { walkPref?: number; dayMinutes?: number; perDay?: number; seedGroups?: number[][]; freeMax?: number; freeDetour?: number; sameMeters?: number; dwell?: DwellCfg; center?: { lat: number; lng: number } } = {}
): ClusterResult {
  const dwell = opts.dwell ?? DWELL_DEFAULT;
  // usable = has coords, de-duped by name; input order IS the value ranking.
  const seen = new Set<string>();
  const pool = poolIn.filter((a) => a.lat != null && a.lng != null).filter((a) => {
    const n = a.name_he || a.name_en; if (seen.has(n)) return false; seen.add(n); return true;
  });
  if (pool.length === 0 || days <= 0) return { days: [], leftOut: [] };

  const pref = opts.walkPref ?? 3;
  // Walk tolerance scales the day: "walk everything" (5) → longer days that fit
  // more; "minimise walking" (1) → shorter, tighter ones.
  const budget = (opts.dayMinutes ?? 420) * (1 + (pref - 3) * 0.11);

  const placed = new Set<number>();
  const groups: { stops: Attraction[]; time: number }[] = [];

  if (opts.seedGroups?.length) {
    // Explicit neighbourhood tour: the traveller chose areas to tour, so build one
    // guaranteed day per area from its members (value order, budget-trimmed).
    // Overrides `days` — the chosen neighbourhoods define the days.
    const byId = new Map(pool.map((a) => [a.id, a]));
    for (const ids of opts.seedGroups) {
      const stops: Attraction[] = []; let time = 0;
      for (const id of ids) {
        const x = byId.get(id);
        if (!x || placed.has(x.id)) continue;
        const dist = stops.length ? nearestMin(x, stops) : 0;
        if (time + visitMin(x, dwell) + dist <= budget) { stops.push(x); time += visitMin(x, dwell) + dist; placed.add(x.id); }
      }
      if (stops.length) groups.push({ stops, time });
    }
  } else {
    // Fill EXACTLY `days` days, balanced. Take ~pace top-value candidates per day,
    // build one walking tour, then cut it into `days` contiguous slices of ~pace stops
    // — so every requested day is used and no day is left a scattered stub (the old
    // time-budget cut packed short-dwell stops into fewer dense days + a thin tail).
    const perDay = Math.max(3, opts.perDay ?? Math.round(budget / 78));
    const candidates = pool.slice(0, Math.min(pool.length, days * perDay));
    let start = candidates[0], bestSum = Infinity;
    for (const p of candidates) {
      let s = 0; for (const q of candidates) s += walkBetween(p, q);
      if (s < bestSum) { bestSum = s; start = p; }
    }
    const tour = twoOpt(nnPath(candidates, start));

    // Cut the tour into `days` contiguous chunks of `perDay` stops each — so the trip
    // honours the chosen pace EVENLY (intensive really means ~perDay/day, not "6 short
    // stops on one day, 3 museums on another"). Because the tour is one 2-opt walking
    // path, contiguous count-slices are also geographically tight (each day a stretch of
    // the route). Realized day length stays sane downstream: the ≤N-museums/day cap
    // trims the heaviest stops, so no time ceiling is needed here (it only lopsided the
    // last day by dumping overflow onto it).
    let cur: Attraction[] = [], time = 0;
    for (const x of tour) {
      const leg = cur.length ? walkBetween(cur[cur.length - 1], x) : 0;
      if (cur.length >= perDay && groups.length < days - 1) {
        groups.push({ stops: cur, time });
        cur = []; time = 0;
      }
      cur.push(x); placed.add(x.id); time += visitMin(x, dwell) + (cur.length > 1 ? leg : 0);
    }
    if (cur.length) groups.push({ stops: cur, time });
  }

  // B — free gems: pull nearby places (incl. the long tail) onto each day's route
  // while they sit within a short detour and the day still has budget. The caps are
  // techniques (free_gems principle); fall back to the built-in defaults.
  const freeMax = opts.freeMax ?? FREE_MAX_PER_DAY;
  const freeDetour = opts.freeDetour ?? FREE_DETOUR;
  // Also cap the day at ~pace+1 stops so free gems enrich a day without ballooning it
  // (a compact central day used to hit the time budget only after 8-9 stops).
  const dayCeil = (opts.perDay ?? Math.round((opts.dayMinutes ?? 420) / 78)) + 1;
  for (const g of groups) {
    let added = 0;
    for (const x of pool) {
      if (added >= freeMax || g.stops.length >= dayCeil) break;
      if (placed.has(x.id)) continue;
      const dist = nearestMin(x, g.stops);
      if (dist <= freeDetour && !isDuplicate(x, g.stops) && g.time + visitMin(x, dwell) + dist <= budget) {
        placed.add(x.id);
        g.stops.push(x);
        g.time += visitMin(x, dwell) + dist;
        added++;
      }
    }
  }

  // C — fill thin days: a day left with too few stops (a lone far outlier like
  // Richmond Park) pulls its nearest UN-placed neighbours — even a longer hop the
  // free-gem detour can't reach — so it becomes a real day (Richmond + Kew) instead
  // of a 1-stop stub while worthy picks sit unplaced.
  // (Skip when the traveller chose explicit neighbourhoods — a chosen-area day must
  // stay within its area, not borrow a far stop from another neighbourhood.)
  const MIN_STOPS = opts.seedGroups?.length ? 0 : 3;
  const nearestKm = (a: Attraction, stops: Attraction[]) =>
    Math.min(...stops.map((s) => haversineKm(a.lat as number, a.lng as number, s.lat as number, s.lng as number)));
  for (const g of groups) {
    // pull nearest-to-ANY-stop un-placed picks (so a lone far stop grabs its own
    // neighbours — Kew ~4km from Richmond — not something near the day's midpoint).
    while (g.stops.length < MIN_STOPS) {
      const cand = pool.filter((a) => !placed.has(a.id) && Number.isFinite(a.lat) && Number.isFinite(a.lng))
        .map((a) => ({ a, d: nearestKm(a, g.stops) })).filter((x) => x.d <= 7).sort((x, y) => x.d - y.d)[0];
      if (!cand) break;                       // genuinely isolated — leave it
      g.stops.push(cand.a); placed.add(cand.a.id);
    }
  }

  // D — far neighbourhood → half-day + centre afternoon: a CHOSEN far area
  // (Greenwich) that only fills part of a day tops up its afternoon with worthy
  // stops near the CENTRE, so the day reads "morning far → metro back → central
  // afternoon" instead of a thin far-only day. Only for chosen-neighbourhood builds.
  if (opts.seedGroups?.length && opts.center) {
    const { lat: cLat, lng: cLng } = opts.center;
    const perDay = Math.max(4, opts.perDay ?? Math.round(budget / 78));
    for (const g of groups) {
      if (!g.stops.length) continue;
      const gLat = g.stops.reduce((s, a) => s + (a.lat as number), 0) / g.stops.length;
      const gLng = g.stops.reduce((s, a) => s + (a.lng as number), 0) / g.stops.length;
      const content = g.stops.reduce((s, a) => s + visitMin(a, dwell), 0);
      // far from centre AND under ~60% of the day's time budget → half-day, fill it.
      if (haversineKm(cLat, cLng, gLat, gLng) <= 6 || content >= budget * 0.6 || g.stops.length >= perDay) continue;
      const central = pool.filter((a) => !placed.has(a.id) && Number.isFinite(a.lat) && Number.isFinite(a.lng))
        .map((a) => ({ a, dc: haversineKm(cLat, cLng, a.lat as number, a.lng as number) }))
        .filter((x) => x.dc <= 5).sort((x, y) => stopWorth(y.a) - stopWorth(x.a) || x.dc - y.dc);
      let t = content;
      for (const { a } of central) {
        if (g.stops.length >= perDay || t >= budget) break;
        g.stops.push(a); placed.add(a.id); t += visitMin(a, dwell);
      }
    }
  }

  const ordered = groups.map((g) => orderPath(g.stops)).filter((d) => d.length > 0);
  // Final safety net: collapse same-place / one-complex fragments across the whole
  // trip (name-exact dedup above misses "Louvre pyramid" vs "The Louvre's pyramid").
  const deduped = dedupeAcrossDays(ordered, opts.sameMeters ?? 120).filter((d) => d.length > 0);
  const leftOut = pool.filter((a) => !placed.has(a.id));
  return { days: deduped, leftOut };
}
