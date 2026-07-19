// Proximity day-clustering — turn a value-ranked pool of attractions into
// geographically tight days, so each day is a walkable neighbourhood rather than
// a zig-zag across the city. This is the core of "why not pop into the place
// we're 100m from": nearby attractions cost almost no travel time, so a tight
// day fits MORE stops and the walking itself becomes pleasant.
//
// We use the classic "route-first, cluster-second" heuristic (robust for the
// Team-Orienteering shape of the problem, deterministic, no routing API / AI):
//   1. take the top-value candidates,
//   2. build ONE good walking tour through them (nearest-neighbour + 2-opt) —
//      consecutive stops on a good tour are geographic neighbours,
//   3. cut the tour into `days` contiguous slices by a per-day time budget.
// Because the tour is geographically ordered, every slice is a tight neighbour-
// hood AND the days come out balanced. Starting the tour from the most-central
// candidate means the tour ends at the periphery, so when the budget is full the
// places we drop are the outlying ones — exactly what you'd skip on foot.
//
// Proximity enters as a weight via `walkPref`: it sets the daily time budget, so
// a "walk everything" traveller gets bigger days and a "minimise walking" one
// gets tighter, shorter days.
import type { Attraction } from "./db";
import { haversineKm, walkMinutes, DEFAULT_WALK_PREF } from "./geo";

const VISIT_DEFAULT = 75, VISIT_MIN = 40, VISIT_MAX = 150;

// How long the traveler spends AT a place (minutes), clamped to something sane.
function visitMin(a: Attraction): number {
  const d = a.duration_minutes ?? 0;
  return d ? Math.max(VISIT_MIN, Math.min(VISIT_MAX, d)) : VISIT_DEFAULT;
}

function walkBetween(a: Attraction, b: Attraction): number {
  return walkMinutes(haversineKm(a.lat as number, a.lng as number, b.lat as number, b.lng as number));
}

// Total walking (minutes) along a day's ordered stops.
export function dayWalkMinutes(day: Attraction[]): number {
  let sum = 0;
  for (let i = 0; i < day.length - 1; i++) sum += walkBetween(day[i], day[i + 1]);
  return sum;
}

// 2-opt: reverse segments while it shortens the path (undoes crossings). Paths
// here are short (≤ ~8 stops) so this is effectively free.
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

// Greedy nearest-neighbour path from `start` through `items`.
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

// Order a day's stops as a short walking chain from its first stop.
function orderPath(stops: Attraction[]): Attraction[] {
  return stops.length <= 2 ? stops : twoOpt(nnPath(stops, stops[0]));
}

export type ClusterResult = { days: Attraction[][]; leftOut: Attraction[] };

export function clusterIntoDays(
  poolIn: Attraction[], days: number,
  opts: { walkPref?: number; dayMinutes?: number } = {}
): ClusterResult {
  // usable = has coords, de-duped by name; input order IS the value ranking.
  const seen = new Set<string>();
  const pool = poolIn.filter((a) => a.lat != null && a.lng != null).filter((a) => {
    const n = a.name_he || a.name_en; if (seen.has(n)) return false; seen.add(n); return true;
  });
  if (pool.length === 0 || days <= 0) return { days: [], leftOut: [] };

  // Walk tolerance scales the day: "walk everything" (5) gets longer days that
  // fit more; "minimise walking" (1) gets shorter, tighter ones.
  const pref = opts.walkPref ?? DEFAULT_WALK_PREF;
  const budget = (opts.dayMinutes ?? 420) * (1 + (pref - DEFAULT_WALK_PREF) * 0.11);

  // Candidate set: the top-value places, generous enough that tight days can pack
  // extra stops (up to ~8/day) while the budget decides the real count.
  const candidates = pool.slice(0, Math.min(pool.length, days * 8));

  // Start the tour from the most-central candidate (min total distance to the
  // others), so the tour radiates outward and the budget drops the periphery.
  let start = candidates[0], bestSum = Infinity;
  for (const p of candidates) {
    let s = 0; for (const q of candidates) s += walkBetween(p, q);
    if (s < bestSum) { bestSum = s; start = p; }
  }
  const tour = twoOpt(nnPath(candidates, start));

  // Cut the tour into contiguous day-slices by the per-day time budget. A new day
  // starts fresh (its first stop has no travel cost — you begin the morning
  // there), so inter-cluster jumps aren't charged as walking.
  const dayGroups: Attraction[][] = [];
  let cur: Attraction[] = [], time = 0;
  const leftOut: Attraction[] = [];
  for (const x of tour) {
    const leg = cur.length ? walkBetween(cur[cur.length - 1], x) : 0;
    if (cur.length && time + visitMin(x) + leg > budget) {
      dayGroups.push(cur); cur = []; time = 0;
      if (dayGroups.length >= days) { leftOut.push(x); continue; }
    }
    if (dayGroups.length >= days) { leftOut.push(x); continue; }
    cur.push(x); time += visitMin(x) + (cur.length > 1 ? leg : 0);
  }
  if (cur.length && dayGroups.length < days) dayGroups.push(cur);

  const ordered = dayGroups.map(orderPath).filter((d) => d.length > 0);
  return { days: ordered, leftOut };
}
