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

const VISIT_DEFAULT = 75, VISIT_MIN = 40, VISIT_MAX = 150;
const CANDIDATES_PER_DAY = 8;   // top-value places that seed the tour structure
const FREE_DETOUR = 4;          // minutes off-path a "free gem" may sit (B)
const FREE_MAX_PER_DAY = 3;     // don't drown a day in minor gems

// How long the traveler spends AT a place (minutes), clamped to something sane.
function visitMin(a: Attraction): number {
  const d = a.duration_minutes ?? 0;
  return d ? Math.max(VISIT_MIN, Math.min(VISIT_MAX, d)) : VISIT_DEFAULT;
}

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

const orderPath = (stops: Attraction[]): Attraction[] =>
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
  opts: { walkPref?: number; dayMinutes?: number; seedGroups?: number[][] } = {}
): ClusterResult {
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
        if (time + visitMin(x) + dist <= budget) { stops.push(x); time += visitMin(x) + dist; placed.add(x.id); }
      }
      if (stops.length) groups.push({ stops, time });
    }
  } else {
    // Tour candidates: the top-value places. Start the tour from the most-central
    // one so it radiates outward and the budget drops the periphery.
    const candidates = pool.slice(0, Math.min(pool.length, days * CANDIDATES_PER_DAY));
    let start = candidates[0], bestSum = Infinity;
    for (const p of candidates) {
      let s = 0; for (const q of candidates) s += walkBetween(p, q);
      if (s < bestSum) { bestSum = s; start = p; }
    }
    const tour = twoOpt(nnPath(candidates, start));

    // Cut the tour into contiguous day-slices by the per-day time budget. A new day
    // starts fresh (its first stop has no travel cost — you begin the morning
    // there), so inter-cluster jumps aren't charged as walking.
    let cur: Attraction[] = [], time = 0;
    for (const x of tour) {
      const leg = cur.length ? walkBetween(cur[cur.length - 1], x) : 0;
      if (cur.length && time + visitMin(x) + leg > budget) {
        groups.push({ stops: cur, time });
        cur = []; time = 0;
        if (groups.length >= days) break;   // out of days — the rest is peripheral
      }
      cur.push(x); placed.add(x.id); time += visitMin(x) + (cur.length > 1 ? leg : 0);
    }
    if (cur.length && groups.length < days) groups.push({ stops: cur, time });
  }

  // B — free gems: pull nearby places (incl. the long tail) onto each day's route
  // while they sit within a short detour and the day still has budget.
  for (const g of groups) {
    let added = 0;
    for (const x of pool) {
      if (added >= FREE_MAX_PER_DAY) break;
      if (placed.has(x.id)) continue;
      const dist = nearestMin(x, g.stops);
      if (dist <= FREE_DETOUR && !isDuplicate(x, g.stops) && g.time + visitMin(x) + dist <= budget) {
        placed.add(x.id);
        g.stops.push(x);
        g.time += visitMin(x) + dist;
        added++;
      }
    }
  }

  const ordered = groups.map((g) => orderPath(g.stops)).filter((d) => d.length > 0);
  const leftOut = pool.filter((a) => !placed.has(a.id));
  return { days: ordered, leftOut };
}
