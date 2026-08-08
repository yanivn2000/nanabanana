// Heuristic itinerary builder — a real day-by-day plan from DB attractions,
// WITHOUT Claude. Used as a fallback until ANTHROPIC_API_KEY is configured;
// the AI version (smart scheduling + real "why") replaces it when available.
import type { Attraction, Street } from "./db";
import type { Itinerary, Stop, StopKind } from "./trip-types";
import { refOf, synthId } from "./place";
import { descriptor } from "./labels";
import { familyFit } from "./taste";
import { clusterIntoDays, dayWalkMinutes, dropSamePlace, orderPath } from "./cluster";
import { splitByReach, clusterDayTrips, dayTripToDay, dayTripBudget, widenThinCluster } from "./daytrips";
import { durationHe, haversineKm, round30, travelMinutes as travelMinutesKm } from "./geo";
import { entryExit, type LatLng } from "./access";
import { DWELL_DEFAULT, dwellMinutes, isInSeason, isWrongAfterDark, orientDay, stopMatchesType, type DwellCfg } from "./brain/traits";

// Resolved technique flags the builder honours (from brain_principles via
// resolveBrainRules; all optional → defaults preserve prior behaviour).
export type BuildOpts = {
  month?: number;
  seasonFilter?: boolean;
  dayEnderLast?: boolean;
  maxTypePerDay?: { type: string; max: number }[];
  avoidCats?: string[];
  // Tier-1 schedule feel (minutes) — from the day_window / lunch / visit_default principles.
  dayStartMin?: number;
  lunchAfterMin?: number;
  lunchMinutes?: number;
  // Tier-2 structure — from daytrip_* / free_gems / same_place_km principles.
  daytripThresholdKm?: number;
  daytripPerDays?: number;
  daytripMaxStops?: number;
  samePlaceMeters?: number;
  freeGemMaxPerDay?: number;
  freeGemDetourMin?: number;
  // Dwell minutes per bucket (visit_minutes technique) — how long each stop takes.
  dwell?: DwellCfg;
  // City centre — lets a chosen far neighbourhood that's only a half-day get its
  // afternoon filled with central stops ("morning far, metro back to centre").
  center?: { lat: number; lng: number };
  // Interest/must-see reservation (from the build route): these ids are pinned to
  // the FRONT of the pool so the family familyFit re-sort can't drop the icons.
  reservedIds?: Set<number>;
  // How much of the day to fill: touring minutes (dwell + travel, lunch excluded).
  // Set from the pace mode so a day runs until dinner instead of stopping at N stops.
  dayMinutes?: number;
  // Chosen-theme stops the proximity clusterer tends to drop because they're
  // geographically scattered (nightlife bars, peripheral parks). After clustering,
  // the best few unscheduled ones are force-inserted into their nearest day so a
  // chosen theme is never absent just because its venues aren't centrally located.
  guaranteeIds?: Set<number>;
  // The traveller's explicit ❤ picks — MANDATORY stops. Every one of them is
  // placed in a day (never left to the bank), whatever the geography.
  mustIncludeIds?: Set<number>;
  // Curated evening spots (evening streets/squares as street-stops) — for a
  // no-kids trip each day ends with the nearest unused one as a soft after-dinner
  // slot. The route only passes these for couples, in cities that have them.
  eveningSpots?: Attraction[];
  // Floodlit-but-shut icons (attractions.night_passby). Used only as a PASS-BY
  // at the end of a day, and only when the day ends right beside one.
  nightIcons?: Attraction[];
  nightIconMax?: number; nightIconKm?: number; nightIconMinutes?: number;
  // evening_cap technique — how much evening the engine plans by itself.
  // thin_day technique — the smallest a day may be before it is rebalanced.
  minDayStops?: number; thinMergeKm?: number;
  eveningMaxStops?: number;   // stops starting at/after DINNER_AT_MIN
  eveningHardEnd?: number;    // minutes; nothing starts at/after this
  eveningStartMin?: number;   // evening_slot technique — earliest evening-slot clock
  // Build variety (variety_jitter technique): same parameters should not produce
  // the SAME trip every time. seed drives a deterministic PRNG (same seed → same
  // trip, so the Brain eval stays reproducible); varietyJitter is the shuffle
  // window in rank positions (0 = off). Reserved/❤/guaranteed ids never move.
  seed?: number;
  varietyJitter?: number;
};

// Deterministic PRNG (mulberry32) — the variety layer must be reproducible from
// its seed, so a saved seed can rebuild the exact same trip.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Rank-window shuffle: each unprotected item drifts up to ±strength positions
// from its value rank. Neighbours swap, clear winners stay on top, and which
// mid-tier places make the candidate cut varies between builds — variety without
// quality loss. Protected ids (the traveller's picks, the reservation icons)
// keep their exact rank.
function jitterOrder(pool: Attraction[], seed: number, strength: number, keep?: Set<number>): Attraction[] {
  const rng = mulberry32(seed);
  return pool
    .map((a, i) => ({ a, k: keep?.has(a.id) ? i : i + (rng() - 0.5) * 2 * strength }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.a);
}
// A picked street is a full stop, not a transition. It enters the build as a
// synthetic attraction: a namespaced id in the "street" range (its own id space,
// so it can never collide with a real attraction id) + its canonical ref, and
// its curated dwell via visit_minutes. Lives here (not in a route file) so both
// the consumer build route and the Brain eval convert streets the same way.
export function streetAsStop(s: Street): Attraction {
  const g = s.geometry;
  const ends: [[number, number], [number, number]] | null =
    g && g.length > 1 ? [g[0], g[g.length - 1]] : null;
  return {
    ends, path: g ?? null,
    id: synthId("street", s.id), ref: refOf("street", s.id),
    name_he: s.name_he, name_en: s.name_en, lat: s.lat, lng: s.lng,
    category: "attraction", subcategory: "street", indoor_outdoor: null,
    family_score: null, tips_he: s.vibe_he, website: null, duration_minutes: null,
    visit_minutes: s.dwell_min ?? 45, image_url: s.image_url ?? null, tagline_he: s.best_for_he,
    best_season: null, best_time_he: null, time_of_day: "any", time_of_day_src: "kind", dress_he: null,
    cost_level: null, must_see: 1, osm_must_see: null, editor_rank: null,
    editor_kids: null, description_he: null, taste_tags: null, audience_fit: null,
    admin_bonus: null, notable: false, info_sources: null,
  };
}

const isAvoided = (a: Attraction, avoid?: string[]) => !!avoid?.some((t) => stopMatchesType(a, t));
// Two stops of the same type this close are one visit, not two — the Vatican
// Museums, its Pinacoteca and the Raphael Rooms are halls behind a single ticket.
// "Same visit" is now a CURATED fact (attractions.parent_id), not a guess from
// distance. The 350 m proxy predated the complex layer and was too generous: it
// waved through Frankfurt's Museumsufer, Tirana's museum row and Boston's — all
// separate tickets that happen to stand next to each other — so a "≤2 museums a
// day" rule quietly produced days of three and four. Distance survives only as a
// tight fallback for a complex nobody has curated yet.
const SAME_VISIT_KM = 0.12;
const sameVisit = (a: Attraction, b: Attraction) => {
  const pa = a.parent_id ?? a.id, pb = b.parent_id ?? b.id;
  if (pa === pb) return true;                       // curated: one complex, one visit
  if (a.parent_id != null || b.parent_id != null) return false;   // curated apart
  return Number.isFinite(a.lat) && Number.isFinite(b.lat) &&
    haversineKm(a.lat as number, a.lng as number, b.lat as number, b.lng as number) <= SAME_VISIT_KM;
};
// Drop stops beyond the per-day cap of a type (keeps the earlier = higher-value
// ones). "≤2 museums a day" means two separate museum VISITS: further halls of a
// complex already counted are free, or the cap evicts half the Vatican and the
// backfill scatters it onto other days.
function capTypePerDay(day: Attraction[], caps?: { type: string; max: number }[]): Attraction[] {
  if (!caps?.length) return day;
  const counts: Record<string, number> = {};
  const keptOf: Record<string, Attraction[]> = {};
  return day.filter((a) => {
    let drop = false;
    for (const cap of caps) {
      if (!stopMatchesType(a, cap.type)) continue;
      const kept = keptOf[cap.type] ?? (keptOf[cap.type] = []);
      if (kept.some((k) => sameVisit(a, k))) { kept.push(a); continue; }   // same complex — free
      counts[cap.type] = (counts[cap.type] ?? 0) + 1;
      if (counts[cap.type] > cap.max) drop = true; else kept.push(a);
    }
    return !drop;
  });
}

const KIND_FROM_CAT: Record<string, StopKind> = {
  nature: "nature", museum: "culture", attraction: "culture",
  sport: "nature", food: "food", shopping: "shopping",
  historic: "culture", tourism: "culture", leisure: "nature",
};

const DAY_START_MIN = 9 * 60 + 30;   // 09:30
const LUNCH_AFTER_MIN = 12 * 60;     // drop the meal break at the first stop past 12:00
const EVENING_AT_MIN = 21 * 60;
const LATE_LIMIT_MIN = 20 * 60 + 30;   // past here only evening-appropriate stops
const DINNER_AT_MIN = 19 * 60 + 30;    // "after dinner" starts here (matches the trip page)      // evening street/square slot — after the 19:30+90 dinner
const LUNCH_MIN = 60;
const fmtClock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
// Time between stops — walk vs transit, shared with the editor via geo.travelMinutes.
const travelMinutes = (a: Attraction, b: Attraction) => {
  if (!(Number.isFinite(a.lat) && Number.isFinite(a.lng) && Number.isFinite(b.lat) && Number.isFinite(b.lng))) return 10;
  return travelMinutesKm(haversineKm(a.lat as number, a.lng as number, b.lat as number, b.lng as number));
};


// Resolve each stop's ENTER/EXIT ports for the ordered day, via the shared
// access-point contract (lib/access.ts). A point is both; a street is entered at
// the end nearer where you came from and left from the other.
function resolveEnds(picks: Attraction[]): { arr: LatLng; dep: LatLng }[] {
  const out: { arr: LatLng; dep: LatLng }[] = [];
  let prev: LatLng | null = null;
  for (let i = 0; i < picks.length; i++) {
    const nxt = picks[i + 1] ?? null;
    const to: LatLng | null = nxt && nxt.lat != null && nxt.lng != null
      ? (nxt.ends ? nxt.ends[0] : [nxt.lat, nxt.lng]) : null;
    const { enter, exit } = entryExit(picks[i], prev, to);
    out.push({ arr: enter, dep: exit });
    prev = exit;
  }
  return out;
}

function kindOf(a: Attraction): StopKind {
  return KIND_FROM_CAT[a.category] ?? "culture";
}

// A long street (Prinsengracht is 3.3km) shouldn't be drawn or walked end-to-end
// — you do a STRETCH of it. Take the ~STRETCH_M window of the polyline nearest the
// day's OTHER stops, so the map isn't dominated by one giant line and the walk
// reflects a realistic segment. Returns the trimmed path; the caller resets ends +
// centroid from it. Anchoring to the nearest other stop (not the ordered-previous
// one) is order-independent, so trimming can run BEFORE ordering — the order then
// reacts to where the segment really sits, not the full-street midpoint.
const STRETCH_M = 750;
function metersBetween(p: LatLng, q: LatLng): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLa = rad(q[0] - p[0]), dLo = rad(q[1] - p[1]);
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(rad(p[0])) * Math.cos(rad(q[0])) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function stretchAround(path: LatLng[], near: LatLng, maxM: number): LatLng[] {
  let bi = 0, bd = Infinity;
  for (let k = 0; k < path.length; k++) { const d = metersBetween(path[k], near); if (d < bd) { bd = d; bi = k; } }
  let lo = bi, hi = bi, acc = 0;
  while (acc < maxM && (lo > 0 || hi < path.length - 1)) {
    const canLo = lo > 0, canHi = hi < path.length - 1;
    const dLo = canLo ? metersBetween(path[lo - 1], path[lo]) : Infinity;
    const dHi = canHi ? metersBetween(path[hi], path[hi + 1]) : Infinity;
    if (dLo <= dHi) { acc += dLo; lo--; } else { acc += dHi; hi++; }
  }
  return path.slice(lo, hi + 1);
}
// Trim any long linear stop to a stretch near the day's other stops.
function trimLongStreets(picks: Attraction[]): Attraction[] {
  return picks.map((a, i) => {
    if (!a.path || a.path.length < 3) return a;
    let len = 0;
    for (let k = 1; k < a.path.length; k++) len += metersBetween(a.path[k - 1], a.path[k]);
    if (len <= STRETCH_M) return a;
    // Anchor = whichever OTHER chosen stop sits closest to any point on the street.
    // Order-independent, so this runs before ordering; the stretch lands on the part
    // of the street facing the rest of the day.
    let near: LatLng = a.path[Math.floor(a.path.length / 2)];
    let best = Infinity;
    for (let j = 0; j < picks.length; j++) {
      const o = picks[j];
      if (j === i || o.lat == null || o.lng == null) continue;
      const op: LatLng = [o.lat as number, o.lng as number];
      let dmin = Infinity;
      for (const p of a.path) { const d = metersBetween(op, p); if (d < dmin) dmin = d; }
      if (dmin < best) { best = dmin; near = op; }
    }
    const seg = stretchAround(a.path, near, STRETCH_M);
    const clat = seg.reduce((s, p) => s + p[0], 0) / seg.length;
    const clng = seg.reduce((s, p) => s + p[1], 0) / seg.length;
    return { ...a, path: seg, ends: [seg[0], seg[seg.length - 1]], lat: clat, lng: clng };
  });
}

export function buildHeuristicItinerary(
  city: string,
  country: string,
  days: number,
  attractions: Attraction[],
  isFamily = false,
  perDay = 5,
  walkPref = 3,
  seedGroups?: number[][],
  opts?: BuildOpts
): Itinerary {
  // Techniques from the principles table (opts): season filter + audience avoids
  // happen on the pool BEFORE clustering.
  const filtered = attractions
    .filter((a) => opts?.seasonFilter === false || isInSeason(a, opts?.month))
    // An explicit ❤ pick beats the audience avoid-list: "כל בחירה נכנסת ליומן"
    // outranks "מבוגרים בלי פארקי-מים" when the traveller chose one on purpose.
    .filter((a) => !isAvoided(a, opts?.avoidCats) || !!opts?.mustIncludeIds?.has(a.id));
  // The input is already taste-ranked; for kids, re-sort by family_score. (An active
  // anchor per family day is enforced by the critic flag + the higher family pace,
  // NOT by a ranking boost — a boost distorted must-see coverage. v1.2.) The route's
  // interest/must-see reservation is pinned first (targeted floor of ~days+K stops),
  // so the family re-sort keeps the icons in the candidate window without a blanket
  // must-see boost.
  const rsv = opts?.reservedIds;
  const poolRanked = isFamily
    ? [...filtered].sort((a, b) =>
        (Number(rsv?.has(b.id) ?? false) - Number(rsv?.has(a.id) ?? false)) || (familyFit(b) - familyFit(a)))
    : filtered;
  // Variety layer: jitter the ranked order inside a ±N-position window so two
  // builds with identical parameters differ in their mid-tier picks. The
  // traveller's ❤/reserved/guaranteed stops keep their exact rank — variety must
  // never cost a promise. Off when no seed/strength (saved modules, tests).
  const jStrength = opts?.varietyJitter ?? 0;
  const protectedIds = new Set<number>([...(rsv ?? []), ...(opts?.mustIncludeIds ?? []), ...(opts?.guaranteeIds ?? [])]);
  const poolAll = jStrength > 0 && opts?.seed != null
    ? jitterOrder(poolRanked, opts.seed, jStrength, protectedIds)
    : poolRanked;

  // Nightlife is an EVENING activity — it must NOT compete with markets/museums for
  // daytime proximity slots. Pull the CHOSEN nightlife venues out of the day pool and
  // schedule them as an evening slot per day (below), so "food + nightlife" gets both:
  // markets by day, a bar by night. Only when nightlife was actually chosen (in
  // guaranteeIds) — otherwise a stray bar never appears.
  const NIGHTLIFE_SUBS = new Set(["bar", "pub", "nightclub", "cocktail", "wine_bar",
    "biergarten", "brewery", "jazz_club", "music_venue", "lounge", "nightlife", "disco"]);
  // A bar/club is never a DAYTIME stop → keep every nightlife venue out of the day
  // pool. Only the CHOSEN ones (in guaranteeIds) become evening slots below.
  const isNightSubcat = (a: Attraction) => !!a.subcategory && NIGHTLIFE_SUBS.has(a.subcategory)
    && Number.isFinite(a.lat) && Number.isFinite(a.lng);
  const anyNight = poolAll.some(isNightSubcat);
  const nightVenues = poolAll.filter((a) => isNightSubcat(a) && !!opts?.guaranteeIds?.has(a.id));
  const pool = anyNight ? poolAll.filter((a) => !isNightSubcat(a)) : poolAll;

  // Proximity clustering: instead of slicing the ranked list into days (which
  // scatters each day across the city), group geographically so every day is a
  // walkable neighbourhood. seedGroups (chosen-neighbourhood tour) force one day
  // per area. The per-day budget is derived from the pace.
  const dwell = opts?.dwell ?? DWELL_DEFAULT;
  // The day is filled by TIME (touring minutes up to dinner), not by a stop count —
  // a drive-by landmark and a three-hour museum are not "one attraction" each. The
  // caller passes the mode's budget via opts.dayMinutes; perDay stays only as a
  // runaway guard so time is what actually binds.
  const dayMinutes = opts?.dayMinutes ?? perDay * 84;
  // PARENT + CHILDREN travel as ONE stop through the day-builder. A sub-attraction
  // (the Sistine inside the Vatican, the arena inside the Colosseum) is not a
  // separate visit you can schedule on another day — it is what you see once you
  // are inside. Collapsing them here is what finally fixes the split: the clusterer
  // budgets the whole visit as one, so the day can never be cut through the middle
  // of it. They are expanded back, in place, right after clustering.
  const inPool = new Set(pool.map((a) => a.id));
  const kidsOf = new Map<number, Attraction[]>();
  // Only collapse when the PARENT itself made the pool — otherwise its children
  // would vanish from the build entirely. A parent whose child is a must-see is
  // promoted in the data, so this is a safety net, not the normal path.
  for (const a of pool) if (a.parent_id != null && inPool.has(a.parent_id)) {
    const arr = kidsOf.get(a.parent_id); arr ? arr.push(a) : kidsOf.set(a.parent_id, [a]);
  }
  const isChild = (a: Attraction) => a.parent_id != null && kidsOf.has(a.parent_id);
  const clusterPool = kidsOf.size
    ? pool.filter((a) => !isChild(a)).map((a) => {
        const kids = kidsOf.get(a.id);
        if (!kids?.length) return a;
        // the parent carries the whole visit's dwell so the day budget stays honest
        const total = (a.passby_minutes ?? dwellMinutes(a, opts?.dwell ?? DWELL_DEFAULT))
          + kids.reduce((s, k) => s + dwellMinutes(k, opts?.dwell ?? DWELL_DEFAULT), 0);
        return { ...a, visit_minutes: total };
      })
    : pool;

  const { days: clustered0 } = clusterIntoDays(clusterPool, days, { walkPref, dayMinutes, perDay, seedGroups,
    freeMax: opts?.freeGemMaxPerDay, freeDetour: opts?.freeGemDetourMin, dwell, center: opts?.center,
    minDayStops: opts?.minDayStops, thinMergeKm: opts?.thinMergeKm });
  const clustered = kidsOf.size
    ? clustered0.map((day) => day.flatMap((a) => {
        const kids = kidsOf.get(a.id);
        return kids?.length ? [pool.find((p) => p.id === a.id) ?? a, ...kids] : [a];
      }))
    : clustered0;

  // Per-day techniques: drop same-place dups + cap types (e.g. ≤2 museums/day), then
  // BACKFILL each thinned day back toward the pace from nearby unused worthy stops —
  // so obeying "≤2 museums/day" on a museum-heavy city (Amsterdam) doesn't leave an
  // intensive day with 3 stops. Backfill stays local (within the day's turf) and keeps
  // the caps. Done across ALL days first (shared usedIds) so no stop is added twice.
  const caps = opts?.maxTypePerDay;
  const sameMeters = opts?.samePlaceMeters ?? 90;
  // Backfill stays local (3.5km) on a normal day; a still-thin far cluster (a
  // Richmond/Kew half-day) escalates to 7km so it fills toward the pace too.
  const FILL_KM = 3.5, FILL_KM_FAR = 7;
  // ONE PLACE, ONE SLOT PER TRIP. Every attraction picked anywhere in the trip
  // lands here and is never picked again — see docs/logic/repeat-visits.md for
  // the full rule, the two exceptions (evening streets ×2, night icons ×1) and
  // why the traveller can still add a repeat by hand on the trip page.
  const usedIds = new Set<number>();
  const capped = clustered.map((picksRaw) => {
    const picks = capTypePerDay(dropSamePlace(picksRaw, opts?.samePlaceMeters), caps);
    picks.forEach((a) => usedIds.add(a.id));
    return picks;
  });
  // Day cohesion: a day must be a WALKABLE cluster. If its route has a "bridge"
  // leg (one long hop splitting it into two clusters — a South-Ken museum day with
  // Richmond Park 9km away, or a canal day with a suburban forest 6km south), drop
  // the lower-worth side. A far NON-nature must-see (a palace) is kept — worth the
  // transit — but a far nature must-see (a suburban forest/park) is a nice-to-have
  // that must never anchor a tight city day, so it's shed. Runs BEFORE the backfill
  // so the thinned day refills with NEARBY stops, not the far outlier again.
  // Skipped for a chosen-neighbourhood tour (seedGroups) — those days are intentional.
  const COHESION_KM = 4.5;
  const worth = (a: Attraction) => (a.must_see === 1 ? 1000 : 0) +
    Math.max(a.audience_fit?.families ?? 0, a.audience_fit?.couples ?? 0, a.audience_fit?.friends ?? 0);
  if (!seedGroups?.length) {
    for (const day of capped) {
      for (let guard = 0; guard < 4 && day.length > 2; guard++) {
        const path = orderPath(day);
        let bi = -1, bd = 0;
        for (let i = 1; i < path.length; i++) {
          const km = haversineKm(path[i - 1].lat as number, path[i - 1].lng as number, path[i].lat as number, path[i].lng as number);
          if (km > bd) { bd = km; bi = i; }
        }
        if (bd <= COHESION_KM || bi < 1) break;
        const A = path.slice(0, bi), B = path.slice(bi);
        const wA = A.reduce((s, a) => s + worth(a), 0), wB = B.reduce((s, a) => s + worth(a), 0);
        const low = wA <= wB ? A : B;
        if (low.some((a) => a.must_see === 1 && a.category !== "nature")) break;
        day.length = 0; day.push(...(low === A ? B : A));
        // Release the shed side back to the unused pool so the backfill + guarantee
        // passes can re-home those stops on a NEARER day (e.g. a picked place that
        // was the scattered tail of one day belongs to another day's cluster) instead
        // of them staying "used" here and silently going to the bank.
        low.forEach((a) => usedIds.delete(a.id));
      }
    }
  }
  const nearAnyKm = (a: Attraction, stops: Attraction[]) => {
    if (!(Number.isFinite(a.lat) && Number.isFinite(a.lng))) return Infinity;
    return Math.min(...stops.map((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)
      ? haversineKm(a.lat as number, a.lng as number, s.lat as number, s.lng as number) : Infinity));
  };
  const isDup = (a: Attraction, stops: Attraction[]) => stops.some((s) =>
    Number.isFinite(a.lat) && Number.isFinite(s.lat) &&
    haversineKm(a.lat as number, a.lng as number, s.lat as number, s.lng as number) * 1000 <= sameMeters);
  for (const picks of capped) {
    if (picks.length >= perDay || !picks.length) continue;
    const counts: Record<string, number> = {};
    for (const a of picks) for (const c of caps ?? []) if (stopMatchesType(a, c.type)) counts[c.type] = (counts[c.type] ?? 0) + 1;
    const underCap = (a: Attraction) => (caps ?? []).every((c) => !stopMatchesType(a, c.type) || (counts[c.type] ?? 0) < c.max);
    // The backfill honours the day's TIME budget, not just the stop count — perDay
    // is only the runaway guard. Without this, topping a day up "to 8 stops" with
    // heavy dwells (2½h markets, 2h museums) ran the clock to 23:30 and the evening
    // slot landed at 01:30. Estimate = dwells + a rough 12min/hop for travel.
    const estMinutes = () => picks.reduce((s, a) => s + dwellMinutes(a, dwell), 0) + Math.max(0, picks.length - 1) * 12;
    const fill = (maxKm: number) => {
      while (picks.length < perDay && estMinutes() < dayMinutes) {
        const cand = pool
          .filter((a) => !usedIds.has(a.id) && !isChild(a))
          .map((a) => ({ a, d: nearAnyKm(a, picks) }))
          .filter((x) => x.d <= maxKm && underCap(x.a) && !isDup(x.a, picks))
          .sort((x, y) => x.d - y.d)[0];
        if (!cand) break;
        picks.push(cand.a); usedIds.add(cand.a.id);
        for (const c of caps ?? []) if (stopMatchesType(cand.a, c.type)) counts[c.type] = (counts[c.type] ?? 0) + 1;
      }
    };
    fill(FILL_KM);
    if (picks.length < perDay - 1) fill(FILL_KM_FAR);   // thin far cluster → widen once
  }

  // GUARANTEE PASS: a chosen theme whose venues are geographically scattered
  // (nightlife bars, peripheral parks) gets skipped by the proximity clusterer — so
  // "chose nightlife" could yield zero bars. Force the best few unscheduled
  // guarantee stops into their NEAREST day (≈1 per day), so the theme is present.
  const gIds = opts?.guaranteeIds;
  if (gIds?.size) {
    let budget = 2 * days;   // ~2/day, enough that several chosen themes each land
    for (const a of pool) {
      if (budget <= 0) break;
      if (!gIds.has(a.id) || usedIds.has(a.id)) continue;
      if (!(Number.isFinite(a.lat) && Number.isFinite(a.lng))) continue;
      let bestD = -1, bestKm = Infinity;
      capped.forEach((day, di) => {
        if (!day.length) return;
        const km = nearAnyKm(a, day);
        if (km < bestKm) { bestKm = km; bestD = di; }
      });
      if (bestD < 0 || bestKm > 8) continue;   // too far from any day → leave in the bank (needs a day-trip)
      if (capped[bestD].length >= perDay + 2) continue;   // don't bloat a day
      capped[bestD].push(a); usedIds.add(a.id); budget--;
    }
  }

  // MANDATORY picks — the places the traveller explicitly chose. Promise to the
  // user: every ❤ lands IN the itinerary, never in the bank. So unlike the themed
  // guarantee above this pass has NO budget, NO distance limit and NO day-size cap:
  // whatever survived the clusterer's trimming is force-placed into its nearest
  // day (a genuinely remote pick joins the day it's closest to, which is where the
  // traveller would drive to it anyway). Runs last so nothing downstream drops it.
  const mustIds = opts?.mustIncludeIds;
  if (mustIds?.size) {
    for (const a of pool) {
      if (!mustIds.has(a.id) || usedIds.has(a.id)) continue;
      if (!(Number.isFinite(a.lat) && Number.isFinite(a.lng))) continue;
      let bestD = -1, bestKm = Infinity;
      capped.forEach((day, di) => {
        const km = day.length ? nearAnyKm(a, day) : 0;   // an empty day takes it outright
        if (km < bestKm) { bestKm = km; bestD = di; }
      });
      if (bestD < 0) bestD = 0;
      capped[bestD].push(a); usedIds.add(a.id);
    }
  }

  // FINAL RECONCILIATION — a child ends the build on its parent's day, always.
  // Every pass between here and the collapse (the type cap, the cohesion split, the
  // backfill) can still evict a stop on its own merits, and a sub-attraction evicted
  // alone is nonsense: you cannot skip the Temple of Athena Nike but climb the
  // Acropolis, or bank the Pergamon while visiting Museum Island. No geometry here —
  // just "put it back where its parent is", which is what the editor declared.
  if (kidsOf.size) {
    const dayOfParent = new Map<number, number>();
    capped.forEach((day, di) => day.forEach((a) => { if (kidsOf.has(a.id)) dayOfParent.set(a.id, di); }));
    if (dayOfParent.size) {
      const placed = new Set(capped.flat().map((a) => a.id));
      for (const [pid, di] of dayOfParent) {
        for (const kid of kidsOf.get(pid) ?? []) {
          if (placed.has(kid.id)) {
            const at = capped.findIndex((d) => d.some((x) => x.id === kid.id));
            if (at === di || at < 0) continue;
            capped[at] = capped[at].filter((x) => x.id !== kid.id);
          }
          capped[di].push(kid); placed.add(kid.id); usedIds.add(kid.id);
        }
      }
    }
  }

  const usedNight = new Set<number>();   // chosen nightlife venues already placed as an evening slot
  const evUses = new Map<number, number>();
  // Night-icon budget for the whole trip (technique night_passby).
  const usedIcons = new Set<number>();
  let iconsLeft = opts?.nightIconMax ?? 1;
  const iconKm = opts?.nightIconKm ?? 0.8;
  const iconMinutes = opts?.nightIconMinutes ?? 20;   // evening-street uses this trip (cap: 2)
  const dayList = capped.map((pickFinal, d) => {
    // Order each day by PROXIMITY (NN + 2-opt) after cap+backfill, then ORIENT the
    // whole route so morning-leaning stops fall earlier and evening / day-ender ones
    // later — by flipping the path's direction, never by pulling a single stop out of
    // sequence. A per-stop time-of-day reshuffle used to tear a cluster apart (a
    // sunset museum sent across the IJ to the day's end, away from its neighbour). The
    // orientation keeps every adjacency intact — proximity wins, timing is a nudge.
    // Trim long streets to their stretch FIRST (anchored to the nearest other stop),
    // so orderPath sees each street at the location it will actually be drawn — not
    // its full-length midpoint, which slotted it in the wrong place in the sequence.
    const picks = orientDay(orderPath(trimLongStreets(pickFinal)), opts?.dayEnderLast !== false);
    const stops: Stop[] = [];
    // Sequential clock: arrival = running time, then add the stay + travel to the
    // next stop, so times always increase and reflect real durations. The lunch
    // break is dropped at the first stop boundary past noon — no fixed slots.
    const startMin = opts?.dayStartMin ?? DAY_START_MIN;
    const lunchAfter = opts?.lunchAfterMin ?? LUNCH_AFTER_MIN;
    const lunchLen = opts?.lunchMinutes ?? LUNCH_MIN;
    let clock = round30(startMin);
    let lunchDone = false;
    // evening_cap: counted per DAY, not per trip.
    const evMaxStops = opts?.eveningMaxStops ?? 2;
    const evHardEnd = opts?.eveningHardEnd ?? 23 * 60 + 30;
    let evCount = 0;
    const ends = resolveEnds(picks);
    picks.forEach((a, i) => {
      if (!lunchDone && i > 0 && clock >= lunchAfter) {
        const t = round30(clock);
        stops.push({ name: "הפסקת צהריים", kind: "food", time: fmtClock(t), duration: durationHe(lunchLen), note: "מסעדה מקומית באזור" });
        clock = t + lunchLen;
        lunchDone = true;
      }
      // snap each arrival to the nearest half hour → clean :00/:30 slots
      const arr = round30(clock);
      // A museum, market, memorial or park scheduled past closing is not a late
      // option, it is a mistake — the day simply ends here and the rest of the
      // picks fall to the bank, where the traveller can move them to another day.
      if (arr >= LATE_LIMIT_MIN && isWrongAfterDark(a)) return;
      // The evening does not stretch: at most eveningMaxStops after dinner, and
      // nothing starts after the hard end. Anyone who wants a third late stop adds
      // it themselves on the trip page — the engine will not send a family out
      // past midnight (evening_cap technique).
      if (arr >= evHardEnd) return;
      if (arr >= DINNER_AT_MIN) {
        if (evCount >= evMaxStops) return;
        evCount++;
      }
      stops.push({
        name: a.name_he || a.name_en,
        kind: kindOf(a),
        time: fmtClock(arr),
        duration: durationHe(dwellMinutes(a, dwell)),
        score: isFamily ? (a.family_score ?? undefined) : undefined,
        note: a.tips_he || descriptor(a),
        // carry coords/id so between-stop travel legs + map pins work without
        // depending on a later attachDetails pass (e.g. saved modules).
        id: a.id, lat: a.lat, lng: a.lng, image: a.image_url, tagline: a.tagline_he, timeOfDay: a.time_of_day ?? null,
        ...(a.path ? { path: a.path } : {}),
      });
      clock = arr + dwellMinutes(a, dwell);
      // travel = from where we LEAVE this stop to where we ENTER the next
      if (i < picks.length - 1) {
        const from = ends[i].dep, to = ends[i + 1].arr;
        clock += Number.isFinite(from[0]) && Number.isFinite(to[0])
          ? travelMinutesKm(haversineKm(from[0], from[1], to[0], to[1]))
          : travelMinutes(a, picks[i + 1]);
      }
    });

    // EVENING nightlife slot: after the day's sightseeing, add the nearest un-used
    // chosen bar/club as a night stop (≥ ~20:30) — so nightlife lands at night and
    // never competes with daytime markets/museums for a proximity slot.
    let nightPlaced = false;
    if (nightVenues.length && picks.length) {
      const last = picks[picks.length - 1];
      const cand = nightVenues
        // A "nightlife" row that the data says is a daytime place (a market
        // hall, a food court) is not a night stop, whatever OSM tagged it.
        .filter((v) => !usedNight.has(v.id) && !isWrongAfterDark(v))
        .map((v) => ({ v, km: haversineKm(last.lat as number, last.lng as number, v.lat as number, v.lng as number) }))
        .sort((x, y) => x.km - y.km)[0];
      if (cand && evCount < evMaxStops) {
        usedNight.add(cand.v.id);
        nightPlaced = true;
        evCount++;
        const v = cand.v;
        const nightClock = Math.max(round30(clock) + 60, 20 * 60 + 30);   // after the day, ≥ 20:30
        stops.push({
          name: v.name_he || v.name_en, kind: kindOf(v), time: fmtClock(nightClock),
          duration: durationHe(dwellMinutes(v, dwell)), note: v.tips_he || descriptor(v),
          id: v.id, lat: v.lat, lng: v.lng, image: v.image_url, tagline: v.tagline_he, timeOfDay: v.time_of_day ?? "any",
        });
      }
    }
    // EVENING street/square slot (couples): a soft after-dinner recommendation as a
    // real itinerary slot — the nearest curated evening street/square (ברי הריסות,
    // כיכר ערב, טיילת) not used on another day. Skipped when the traveller's own
    // nightlife pick already fills the evening. Same slot mechanics as above, but
    // sourced from the editor-curated evening layer, not from OSM bar rows.
    if (!nightPlaced && opts?.eveningSpots?.length && picks.length) {
      const last = picks[picks.length - 1];
      // Reuse policy: a spot may repeat, but at most TWICE per trip — one evening
      // street five nights in a row reads as a bug, not a recommendation. Days left
      // uncovered are flagged by the Brain's eveningEnd check, which is the honest
      // signal to curate more spots. A candidate also must not sit where the day
      // already was (≥250m from every scheduled stop) — "ending" at a street you
      // toured at noon (הונגדה) is a repeat, not an evening plan.
      const evAll = opts.eveningSpots.filter((v) => !usedIds.has(v.id) && (evUses.get(v.id) ?? 0) < 2);
      // Prefer an evening spot the day has not already walked through. But when
      // that leaves nothing, take the near one anyway: on Mykonos every curated
      // evening spot is in Chora, and the rule was costing those days an evening
      // entirely. These entries are evening-framed by name ("ונציה הקטנה (ערב)",
      // "טחנות הרוח בשקיעה") — the same place after dark is a different visit.
      const away = evAll.filter((v) =>
        picks.every((p) => !(Number.isFinite(p.lat) && Number.isFinite(p.lng)) ||
          haversineKm(p.lat as number, p.lng as number, v.lat as number, v.lng as number) > 0.25));
      const evPool = away.length ? away : evAll;
      const evFresh = evPool.filter((v) => !(evUses.get(v.id) ?? 0));
      const cand = (evFresh.length ? evFresh : evPool)
        .map((v) => ({ v, km: haversineKm(last.lat as number, last.lng as number, v.lat as number, v.lng as number) }))
        .sort((x, y) => x.km - y.km)[0];
      // A floodlit icon right where the day ended — the Colosseum lit up, the
      // dome above the square. It goes BEFORE the evening street, not instead of
      // it: twenty minutes of photographs from outside, then on to the square for
      // the actual evening, so the day still ENDS at an evening spot. A pass-by,
      // never a visit (the place is shut), and once per trip so it stays a
      // highlight rather than a habit.
      const iconCand = iconsLeft > 0 ? (opts?.nightIcons ?? [])
        .filter((v) => !usedIds.has(v.id) && !usedIcons.has(v.id) &&
          Number.isFinite(v.lat) && Number.isFinite(v.lng))
        .map((v) => ({ v, km: haversineKm(last.lat as number, last.lng as number, v.lat as number, v.lng as number) }))
        .filter((x) => x.km <= iconKm)
        .sort((x, y) => x.km - y.km)[0] : undefined;
      // A day that somehow still overran past ~22:00 gets NO evening slot (a 01:30
      // stop is nonsense) — the Brain's eveningEnd check then flags that day, which
      // is the right signal: fix the day, don't decorate it.
      if (iconCand && evCount < evMaxStops && round30(clock) + 60 + iconMinutes <= 22 * 60 + 30) {
        usedIcons.add(iconCand.v.id);
        iconsLeft -= 1;
        const v = iconCand.v;
        const iconClock = Math.max(round30(clock) + 60, opts?.eveningStartMin ?? EVENING_AT_MIN);
        stops.push({
          name: v.name_he || v.name_en, kind: kindOf(v), time: fmtClock(iconClock),
          duration: durationHe(iconMinutes),
          note: "רק מבחוץ — המקום סגור בשעה זו, אבל מואר ומרהיב לצילום.",
          id: v.id, lat: v.lat, lng: v.lng, image: v.image_url, tagline: v.tagline_he,
          timeOfDay: "any", passby: true,
        });
        evCount++;
        // the evening street now follows the icon, not the last daytime pick
        clock = iconClock + iconMinutes;
      }
      if (cand && evCount < evMaxStops && round30(clock) + (iconCand ? 15 : 60) <= 22 * 60 + 30) {
        evUses.set(cand.v.id, (evUses.get(cand.v.id) ?? 0) + 1);
        const v = cand.v;
        const evClock = Math.max(round30(clock) + (iconCand ? 15 : 60), opts?.eveningStartMin ?? EVENING_AT_MIN);
        stops.push({
          name: v.name_he || v.name_en, kind: kindOf(v), time: fmtClock(evClock),
          duration: durationHe(dwellMinutes(v, dwell)), note: v.tips_he || descriptor(v),
          id: v.id, lat: v.lat, lng: v.lng, image: v.image_url, tagline: v.tagline_he,
          // A curated evening spot is valid after dark by construction — say so
          // on the stop, so nothing downstream re-decides it from the name.
          timeOfDay: v.time_of_day ?? "any",
          ...(v.path ? { path: v.path } : {}),
        });
      }
    }

    const kinds = new Set(picks.map((a) => kindOf(a)));
    const mix = kinds.has("nature") && kinds.has("culture")
      ? "שילבנו טבע ותרבות"
      : kinds.has("nature") ? "יום עם דגש על טבע" : "יום עם דגש על אטרקציות";
    const walk = Math.round(dayWalkMinutes(picks));

    return {
      label: `יום ${d + 1}`,
      date: "",
      base: city,
      why: `${mix} — קיבצנו אזור אחד כדי לצמצם נסיעות (כ-${walk} דק׳ הליכה בין העצירות), עם הפסקת צהריים באמצע.`,
      stops,
    };
  });

  return {
    title: `טיול ב${city}`,
    subtitle: `${days} ימים · ${country}`,
    // carried to the trip page so an edit there obeys the same evening cap
    eveningCap: { maxStops: opts?.eveningMaxStops ?? 2, hardEndMin: opts?.eveningHardEnd ?? 23 * 60 + 30 },
    days: dayList,
  };
}

// Car "star-trip" build for car_base cities: reserve some days as CAR day-trips to
// far worthy clusters (gorges, lakes, ice caves…), keep the rest as walkable
// in-city days. Falls back to a plain in-city build when there are no day-trips.
// See lib/daytrips.ts, docs/logic/mobility.md.
export function buildCarBaseItinerary(
  city: string,
  country: string,
  days: number,
  attractions: Attraction[],
  center: { lat: number; lng: number },
  isFamily = false,
  perDay = 5,
  walkPref = 3,
  opts?: BuildOpts
): Itinerary {
  // Technique filters (season + avoids) before splitting into city vs day-trips.
  const eligible = attractions
    .filter((a) => opts?.seasonFilter === false || isInSeason(a, opts?.month))
    .filter((a) => !isAvoided(a, opts?.avoidCats));
  const { inCity, far } = splitByReach(eligible, center, opts?.daytripThresholdKm);
  const clusters = clusterDayTrips(far, center, { maxStops: opts?.daytripMaxStops, sameMeters: opts?.samePlaceMeters });
  const tripDays = dayTripBudget(days, clusters.length, opts?.daytripPerDays);
  const cityDays = days - tripDays;

  // No worthy far clusters (or too few days) → ordinary in-city build.
  if (tripDays < 1) return buildHeuristicItinerary(city, country, days, inCity, isFamily, perDay, walkPref, undefined, opts);

  const cityItin = buildHeuristicItinerary(city, country, cityDays, inCity, isFamily, perDay, walkPref, undefined, opts);
  // The allotment (cityDays) is an ASSUMPTION — a thin in-city pool (a base town
  // like Crete/Lefkada with ~8 urban stops) packs into fewer real days. Two
  // consequences handled here:
  //  1) Promote extra day-trip clusters into the freed days, so a 5-day request
  //     stays a 5-day trip when the region has more worthy clusters.
  //  2) Number day-trip days from the ACTUAL city-day count (not the allotment),
  //     so labels never skip ("יום 1 · יום 4 · יום 5").
  const actualCityDays = cityItin.days.length;
  const freed = Math.max(0, cityDays - actualCityDays);
  const effTripDays = Math.min(clusters.length, tripDays + freed);
  // A one-stop day out is not a day (Salzburg day 4 = Schafberg alone, 24 places
  // in the bank). Two rescues, in order:
  //   1. widen the thin cluster with unused far places on the way / near the
  //      anchor — the drive absorbs them for free;
  //   2. still thin → come back and finish the day IN the city, from the same
  //      pool the bank draws on.
  const minDay = opts?.minDayStops ?? 2;
  const chosen = clusters.slice(0, effTripDays);
  const inChosen = new Set(chosen.flatMap((c) => c.stops.map((s) => s.id)));
  const farUnused = far.filter((a) => !inChosen.has(a.id));
  const cityScheduled = new Set(cityItin.days.flatMap((d) => d.stops.map((s) => s.id)).filter((x): x is number => x != null));
  const cityUnused = inCity.filter((a) => !cityScheduled.has(a.id) && Number.isFinite(a.lat) && Number.isFinite(a.lng))
    .sort((a, b) => ((b.must_see === 1 ? 1000 : 0) - (a.must_see === 1 ? 1000 : 0)));
  const tripDayObjs = chosen.map((cl, i) => {
    const wide = widenThinCluster(cl, farUnused, center, minDay, opts?.daytripMaxStops);
    wide.stops.forEach((s) => inChosen.add(s.id));
    const day = dayTripToDay(wide, city, actualCityDays + i + 1, isFamily, { dayStartMin: opts?.dayStartMin, dwell: opts?.dwell ?? DWELL_DEFAULT });
    const real = day.stops.filter((s) => s.id != null);
    if (real.length >= minDay || !cityUnused.length) return day;
    // Back to the city for the afternoon. Clock resumes after the return drive;
    // nothing starts after dark (the same after-dark rule as everywhere else).
    const last = day.stops[day.stops.length - 1];
    const [lh, lm] = (last?.time ?? "13:00").split(":").map(Number);
    let clock = (lh || 13) * 60 + (lm || 0) + 60 + wide.driveMin;   // last dwell + drive back
    const dwell = opts?.dwell ?? DWELL_DEFAULT;
    while (real.length + 0 < minDay + 1 && cityUnused.length) {
      const a = cityUnused.shift()!;
      const arr = Math.ceil(clock / 30) * 30;
      if (arr >= LATE_LIMIT_MIN && isWrongAfterDark(a)) continue;
      if (arr >= (opts?.eveningHardEnd ?? 23 * 60 + 30)) break;
      day.stops.push({
        name: a.name_he || a.name_en, kind: kindOf(a), time: fmtClock(arr),
        duration: durationHe(dwellMinutes(a, dwell)), note: a.tips_he || a.tagline_he || undefined,
        id: a.id, lat: a.lat, lng: a.lng, image: a.image_url, tagline: a.tagline_he,
        timeOfDay: a.time_of_day ?? null,
      });
      real.push(day.stops[day.stops.length - 1]);
      clock = arr + dwellMinutes(a, dwell) + 15;
      cityScheduled.add(a.id);
    }
    if (day.stops.length > (wide.stops.length)) {
      day.why = `${day.why} אחרי הצהריים חוזרים לעיר וממשיכים לטייל בה.`;
    }
    return day;
  });

  // Last resort: a trip day that is STILL one stop after both rescues does not
  // deserve a whole day — drop it and let the trip run shorter; the place stays
  // in the bank one drag away. Only a traveller's OWN pick protects the day
  // (owner: "לזרוק אתר חובה כזה זה הכי חמור") — reservedIds are the engine's own
  // interest reservations, and shielding those let Brasov keep serving a one-stop
  // Bucegi day the engine had merely reserved for itself.
  const protectedIds = new Set([...(opts?.guaranteeIds ?? []), ...(opts?.mustIncludeIds ?? [])]);
  const keptTripDays = tripDayObjs.filter((d) => {
    const real = d.stops.filter((s) => s.id != null);
    return real.length >= 2 || real.some((s) => protectedIds.has(s.id as number));
  });
  // A car_base trip is a rental-car trip throughout: mark every day so between-stop
  // legs read as driving, not public transit. Re-label sequentially as a final
  // guard — even when no extra cluster exists the trip is merely shorter, never
  // gap-numbered.
  const allDays = [...cityItin.days, ...keptTripDays].map((d, i) => ({ ...d, label: `יום ${i + 1}`, carBase: true }));
  return {
    title: `טיול ב${city}`,
    subtitle: `${allDays.length} ימים · ${country} · טיול ברכב שכור · ${keptTripDays.length} ${keptTripDays.length === 1 ? "יום מחוץ לעיר" : "ימים מחוץ לעיר"}`,
    // carried to the trip page so an edit there obeys the same evening cap
    eveningCap: { maxStops: opts?.eveningMaxStops ?? 2, hardEndMin: opts?.eveningHardEnd ?? 23 * 60 + 30 },
    days: allDays,
  };
}

// Multi-city fallback: build each segment, concatenate with continuous day
// numbering. Used when AI is unavailable for a multi-city trip. Each segment
// carries its OWN Brain techniques (opts) — techniques are per-destination, so a
// family Vienna→Salzburg trip applies each city's avoids/dwell/lunch, not defaults.
export function buildMultiHeuristicItinerary(
  segments: { city: string; country: string; days: number; attractions: Attraction[]; opts?: BuildOpts }[],
  isFamily = false,
  perDay = 5,
  walkPref = 3
): Itinerary {
  const days: Itinerary["days"] = [];
  for (const s of segments) {
    const part = buildHeuristicItinerary(s.city, s.country, s.days, s.attractions, isFamily, perDay, walkPref, undefined, s.opts);
    for (const d of part.days) {
      days.push({ ...d, label: `יום ${days.length + 1}`, base: s.city });
    }
  }
  const cities = segments.map((s) => s.city).join(" → ");
  return {
    title: `טיול: ${segments.map((s) => s.city).join(" + ")}`,
    subtitle: `${days.length} ימים · ${cities}`,
    days,
  };
}
