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
import { gapKm, entryExit, type LatLng } from "./access";
import { DWELL_DEFAULT, countVisits, dwellMinutes, type DwellCfg } from "./brain/traits";

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

// One SITE COMPLEX: consecutive stops this close are parts of a single visit and
// must not be split across days. The overflow allowances bound how far a day may
// stretch to finish one.
const SITE_COMPLEX_KM = 0.35;
const COMPLEX_MAX_EXTRA = 3;     // stops beyond the pace, to finish a complex
const COMPLEX_MAX_MIN = 150;     // minutes beyond the day budget, to finish a complex
const FREE_DETOUR = 4;          // minutes off-path a "free gem" may sit (B)
const FREE_MAX_PER_DAY = 3;     // don't drown a day in minor gems

// How long the traveler spends AT a place (minutes) — by what the place IS
// (dwellMinutes), not OSM's unreliable duration. Config is a technique.
const visitMin = (a: Attraction, dwell: DwellCfg = DWELL_DEFAULT): number => dwellMinutes(a, dwell);

// Distance between two stops = the closest pair of their ACCESS POINTS (a street
// is near when either END is near, not measured from its far midpoint). The
// end-awareness lives in one place — lib/access.ts.
function walkBetween(a: Attraction, b: Attraction): number {
  return walkMinutes(gapKm(a, b));
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

// Leg-aware day distances for the critic. Only short hops are WALKED — a long leg
// rides: the car on a car day, the metro in a city (nobody walks 12km across
// London; that's a tube ride). Returns actual walking (min + km) and the ridden
// km so the critic reports each honestly. Walkable threshold: with a car you
// drive anything beyond a parking-hop (~1.3km); on transit you'll walk a bit
// further before it beats waiting for a train (~2km).
export function dayLegStats(day: Attraction[], car = false, walkableKm?: number):
  { walkMin: number; walkKm: number; rideKm: number } {
  const maxWalk = walkableKm ?? (car ? 1.3 : 2.0);
  let walkMin = 0, walkKm = 0, rideKm = 0;
  for (let i = 0; i < day.length - 1; i++) {
    const km = gapKm(day[i], day[i + 1]);
    if (km > maxWalk) rideKm += km;
    else { walkKm += km; walkMin += walkBetween(day[i], day[i + 1]); }
  }
  return { walkMin, walkKm, rideKm };
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
    // A curated sub-attraction is never an accidental duplicate: the Parthenon and
    // the Erechtheion sit 40m apart and are both the point of going up. Only the
    // proximity heuristic is being skipped here — the editor already decided.
    if (a.parent_id != null) { kept.push(a); continue; }
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
// Cross-day half of "one place, one slot per trip" (docs/logic/repeat-visits.md):
// catches the same place mapped at two OSM nodes, which usedIds cannot see.
export function dedupeAcrossDays(days: Attraction[][], minMeters = 120): Attraction[][] {
  const kept: { a: Attraction; d: number; i: number; n: string }[] = [];
  const out: Attraction[][] = days.map(() => []);
  // siblings of one complex are deliberate, never cross-day duplicates
  days.forEach((day, di) => {
    for (const a of day) {
      if (a.parent_id != null) { out[di].push(a); continue; }   // curated sibling, not a dup
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

// End-threaded travel cost of an ORDERED path. A street is a black box with two
// ports: you ENTER at the end nearer where you came from and must EXIT the far end
// (entryExit), so the leg to the next stop starts from that far end — not the
// street's nearest point. Measuring this (instead of symmetric closest-pair) is
// what lets 2-opt see the crossing a street creates when entered from the wrong
// side. Point stops have one port (centroid), so for a point-only day this equals
// the old centroid tour and nothing changes.
function tourCost(path: Attraction[]): number {
  if (path.length < 2) return 0;
  let sum = 0, prevExit: LatLng | null = null;
  const ports = path.map((a, i) => {
    const nxt = path[i + 1];
    const to: LatLng | null = nxt
      ? (nxt.ends ? nxt.ends[0] : nxt.lat != null ? [nxt.lat, nxt.lng as number] : null)
      : null;
    const { enter, exit } = entryExit(a, prevExit, to);
    prevExit = exit;
    return { enter, exit };
  });
  for (let i = 0; i < path.length - 1; i++)
    sum += walkMinutes(haversineKm(ports[i].exit[0], ports[i].exit[1], ports[i + 1].enter[0], ports[i + 1].enter[1]));
  return sum;
}

// 2-opt: reverse segments while it shortens the path (undoes crossings).
//
// A path with NO street (every stop a single-port point) is scored by the cheap
// LOCAL 4-edge delta — identical result to the old behaviour, O(n²), so the big
// route-first tour over ~days*perDay point candidates keeps its speed.
//
// The moment a STREET is present, reversing a segment also flips which end of that
// street is entered/exited, so a local delta is wrong — score the whole path with
// the end-threaded tourCost instead. Street-bearing paths are small (a day), so the
// O(n³) recompute is cheap there.
function twoOpt(path: Attraction[]): Attraction[] {
  return path.some((a) => a.ends) ? twoOptThreaded(path) : twoOptLocal(path);
}

function twoOptLocal(path: Attraction[]): Attraction[] {
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

function twoOptThreaded(path: Attraction[]): Attraction[] {
  let best = tourCost(path);
  for (let pass = 0; pass < 5; pass++) {
    let improved = false;
    for (let i = 1; i < path.length - 1; i++) {
      for (let k = i + 1; k < path.length; k++) {
        const cand = path.slice();
        let lo = i, hi = k;
        while (lo < hi) { const t = cand[lo]; cand[lo] = cand[hi]; cand[hi] = t; lo++; hi--; }
        const c = tourCost(cand);
        if (c + 0.001 < best) { for (let m = 0; m < path.length; m++) path[m] = cand[m]; best = c; improved = true; }
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

// Re-order a day as an OPEN tour that DEPARTS from a fixed depot — the hotel. The
// depot joins as a virtual single-port stop, we NN + 2-opt from it, then drop it:
// the route now starts at the stop nearest the hotel (e.g. add a hotel by street 2
// → the day opens on street 2, not street 1 across town). Uses the same end-aware
// machinery, so a street is still entered/left at its ports. Order-preserving for
// ≤1 stop; leaves the interior optimised, not just rotated.
export function orderFromDepot(stops: Attraction[], depot: { lat: number; lng: number }): Attraction[] {
  if (stops.length <= 1) return stops;
  // virtual depot: a point stop (single access port) with an id that can't collide.
  const anchor = { id: -1, lat: depot.lat, lng: depot.lng } as unknown as Attraction;
  const path = twoOpt(nnPath([anchor, ...stops], anchor)); // nnPath starts at anchor; 2-opt pins index 0
  return path.filter((a) => a.id !== -1);
}

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

// A day of one stop is not a day. It happens in thin cities — Heraklion puts
// Knossos on its own because it sits apart from the old town, Paphos strands the
// water park — and the traveller reads it as the planner giving up. Fold the thin
// day into the day whose centre is nearest, then split the combined set back in
// two along its longest axis: the count of days is preserved (the traveller asked
// for three), the geography holds, and neither half is left with one stop.
//
// Deliberately conservative: only days below MIN_STOPS move, only into a neighbour
// close enough to be the same trip, and a day that cannot be helped is left alone
// for the Brain to flag.
const MIN_STOPS = 2;          // fallback:thin_day
const MERGE_MAX_KM = 40;      // fallback:thin_day — beyond this the two days are different places
const MIN_DAY_MINUTES = 240;  // fallback:thin_day — a day of visits shorter than this is half a day
function centroid(day: Attraction[]) {
  const pts = day.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng));
  if (!pts.length) return null;
  return { lat: pts.reduce((s, a) => s + (a.lat as number), 0) / pts.length,
           lng: pts.reduce((s, a) => s + (a.lng as number), 0) / pts.length };
}
// When the re-split cannot help, TOP UP instead. Crete's couples day was "ארמון
// קנוסוס · חדר הכס בקנוסוס" — one ticket, ~2 hours, and the day ended. Splitting
// Heraklion + Knossos in two just reproduced the same two groups (they are 5 km
// apart, which IS the widest axis), so the old code hit "no better arrangement"
// and left the day at two hours. The pool always has unused places; the day just
// never asked for them.
function topUpDay(day: Attraction[], spare: Attraction[], used: Set<number>,
                  maxKm: number, budget: number, dwell: DwellCfg, min: number,
                  minMinutes: number): boolean {
  const c = centroid(day);
  if (!c) return false;
  let t = day.reduce((s, a) => s + visitMin(a, dwell), 0);
  const near = spare
    .filter((a) => !used.has(a.id) && Number.isFinite(a.lat) && Number.isFinite(a.lng))
    .map((a) => ({ a, km: haversineKm(c.lat, c.lng, a.lat as number, a.lng as number) }))
    .filter((x) => x.km <= maxKm)
    // best-first, then nearest — a thin day should gain the strongest place that
    // is genuinely on the same side of town, not merely the closest filler.
    .sort((x, y) => stopWorth(y.a) - stopWorth(x.a) || x.km - y.km);
  let added = false;
  for (const { a } of near) {
    if (t >= budget || (countVisits(day) > min && t >= minMinutes)) break;
    day.push(a); used.add(a.id); t += visitMin(a, dwell); added = true;
  }
  return added;
}

export function rebalanceThinDays(daysIn: Attraction[][], min = MIN_STOPS, mergeKm = MERGE_MAX_KM,
  spare: Attraction[] = [], spareKm = 8, budget = Infinity, dwell: DwellCfg = DWELL_DEFAULT,
  minMinutes = MIN_DAY_MINUTES): Attraction[][] {
  if (daysIn.length < 2) return daysIn;
  const days = daysIn.map((d) => d.slice());
  const used = new Set<number>(days.flat().map((a) => a.id));
  // The flag and the fixer used to disagree: the Brain called a day thin at
  // "≤2 stops and under 5 hours", while this only acted below 2 VISITS. So every
  // two-stop, two-hour day (Crete's Knossos, Marseille's day 3, Dubai's day 3 —
  // 18 of them across the thin cities) was reported and never repaired. A day is
  // thin here if it is short on visits OR short on the clock.
  const isThin = (d: Attraction[]) => countVisits(d) < min
    || (countVisits(d) <= min && d.reduce((s, a) => s + visitMin(a, dwell), 0) < minMinutes);
  for (let pass = 0; pass < daysIn.length; pass++) {
    const thin = days.findIndex(isThin);
    if (thin === -1) break;
    const c0 = centroid(days[thin]);
    if (!c0) break;
    // nearest OTHER day that has a stop to spare
    let best = -1, bestKm = Infinity;
    days.forEach((d, i) => {
      if (i === thin || isThin(d) || countVisits(d) <= min) return;
      const c = centroid(d);
      if (!c) return;
      const km = haversineKm(c0.lat, c0.lng, c.lat, c.lng);
      if (km < bestKm) { bestKm = km; best = i; }
    });
    // Try the re-split first (it keeps the day count and the geography); fall
    // back to topping the day up from the pool. Only if BOTH fail is the day
    // left alone for the Brain to flag.
    let fixed = false;
    if (best !== -1 && bestKm <= mergeKm) {
      const [a, b] = splitInTwo([...days[thin], ...days[best]]);
      if (!isThin(a) && !isThin(b)) {
        days[thin] = orderPath(a); days[best] = orderPath(b); fixed = true;
      }
    }
    if (!fixed) {
      const d = days[thin].slice();
      if (!topUpDay(d, spare, used, spareKm, budget, dwell, min, minMinutes)) break;
      days[thin] = orderPath(d);
    }
  }
  return days;
}
// Split a set of stops in two along its widest axis, at the median — a cheap,
// deterministic 1-D k-means that keeps each half geographically coherent.
function splitInTwo(stops: Attraction[]): [Attraction[], Attraction[]] {
  const pts = stops.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng));
  if (pts.length < 2) return [stops, []];
  const lats = pts.map((a) => a.lat as number), lngs = pts.map((a) => a.lng as number);
  const spreadLat = Math.max(...lats) - Math.min(...lats);
  const spreadLng = Math.max(...lngs) - Math.min(...lngs);
  const key = (a: Attraction) => (spreadLat >= spreadLng ? (a.lat as number) : (a.lng as number));
  const sorted = pts.slice().sort((x, y) => key(x) - key(y));
  const half = Math.round(sorted.length / 2);
  return [sorted.slice(0, half), sorted.slice(half)];
}

export function clusterIntoDays(
  poolIn: Attraction[], days: number,
  opts: { walkPref?: number; dayMinutes?: number; perDay?: number; seedGroups?: number[][]; freeMax?: number; freeDetour?: number; sameMeters?: number; dwell?: DwellCfg; center?: { lat: number; lng: number }; minDayStops?: number; thinMergeKm?: number; thinSpareKm?: number; thinMinMinutes?: number } = {}
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

    // Cut the tour into `days` contiguous chunks — by stop count (~perDay, the even
    // pace) AND by the day's time budget. Count alone let two 2½h markets land in one
    // slice and run the clock to 23:30 (the museums/day cap doesn't see markets), so a
    // chunk closes at whichever limit hits first. When the LAST day is full, the rest
    // of the tour stays unplaced — it flows to the bank, which is where overflow
    // belongs now (the day must end at dinner/evening, not swallow the tail).
    let cur: Attraction[] = [], time = 0;
    for (const x of tour) {
      let leg = cur.length ? walkBetween(cur[cur.length - 1], x) : 0;
      if (cur.length && (cur.length >= perDay || time + visitMin(x, dwell) + leg > budget)) {
        // Don't cut the day INSIDE one site complex. Consecutive tour stops this
        // close are parts of a single visit — the Vatican Museums, the Sistine
        // Chapel and the Raphael Rooms are one ticket through one building — and a
        // cut there sends the traveller back through the same gate another day. The
        // day may overflow to finish the complex, bounded so it can't run away.
        const prev = cur[cur.length - 1];
        const sameComplex = Number.isFinite(prev.lat) && Number.isFinite(x.lat) &&
          haversineKm(prev.lat as number, prev.lng as number, x.lat as number, x.lng as number) <= SITE_COMPLEX_KM;
        const canOverflow = cur.length < perDay + COMPLEX_MAX_EXTRA && time < budget + COMPLEX_MAX_MIN;
        if (!(sameComplex && canOverflow)) {
        if (groups.length < days - 1) { groups.push({ stops: cur, time }); cur = []; time = 0; leg = 0; }
        else break;   // last day at capacity — remaining tour stops go to the bank
        }
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
  const spare = pool.filter((a) => !placed.has(a.id));
  const balanced = rebalanceThinDays(deduped, opts.minDayStops, opts.thinMergeKm,
    spare, opts.thinSpareKm, budget, dwell, opts.thinMinMinutes);
  // AFTER the rebalance, not before: a place pulled into a thin day must leave
  // the bank, or it would be offered twice — once on the itinerary and once as
  // "didn't make it in".
  const scheduled = new Set(balanced.flat().map((a) => a.id));
  return { days: balanced, leftOut: spare.filter((a) => !scheduled.has(a.id)) };
}
