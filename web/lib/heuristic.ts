// Heuristic itinerary builder — a real day-by-day plan from DB attractions,
// WITHOUT Claude. Used as a fallback until ANTHROPIC_API_KEY is configured;
// the AI version (smart scheduling + real "why") replaces it when available.
import type { Attraction } from "./db";
import type { Itinerary, Stop, StopKind } from "./trip-types";
import { descriptor } from "./labels";
import { familyFit } from "./taste";
import { clusterIntoDays, dayWalkMinutes, dropSamePlace, orderPath } from "./cluster";
import { splitByReach, clusterDayTrips, dayTripToDay, dayTripBudget } from "./daytrips";
import { durationHe, haversineKm, round30, travelMinutes as travelMinutesKm } from "./geo";
import { DWELL_DEFAULT, dwellMinutes, isInSeason, orientDay, stopMatchesType, type DwellCfg } from "./brain/traits";

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
};
const isAvoided = (a: Attraction, avoid?: string[]) => !!avoid?.some((t) => stopMatchesType(a, t));
// Drop stops beyond the per-day cap of a type (keeps the earlier = higher-value ones).
function capTypePerDay(day: Attraction[], caps?: { type: string; max: number }[]): Attraction[] {
  if (!caps?.length) return day;
  const counts: Record<string, number> = {};
  return day.filter((a) => {
    let drop = false;
    for (const cap of caps) if (stopMatchesType(a, cap.type)) { counts[cap.type] = (counts[cap.type] ?? 0) + 1; if (counts[cap.type] > cap.max) drop = true; }
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
const LUNCH_MIN = 60;
const fmtClock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
// Time between stops — walk vs transit, shared with the editor via geo.travelMinutes.
const travelMinutes = (a: Attraction, b: Attraction) => {
  if (!(Number.isFinite(a.lat) && Number.isFinite(a.lng) && Number.isFinite(b.lat) && Number.isFinite(b.lng))) return 10;
  return travelMinutesKm(haversineKm(a.lat as number, a.lng as number, b.lat as number, b.lng as number));
};


// Where the route ENTERS and LEAVES each stop. A point stop is both. A LINEAR stop
// (a street) is entered at the end nearer where you came from and left from the
// OTHER end — walking its length is dwell, not travel. Measuring a 3km canal from
// its midpoint made every leg to/from it wrong by up to half its length.
function resolveEnds(picks: Attraction[]): { arr: [number, number]; dep: [number, number] }[] {
  const pt = (a: Attraction): [number, number] => [a.lat as number, a.lng as number];
  const out: { arr: [number, number]; dep: [number, number] }[] = [];
  let prev: [number, number] | null = null;
  for (let i = 0; i < picks.length; i++) {
    const a = picks[i];
    if (!a.ends) { const p = pt(a); out.push({ arr: p, dep: p }); prev = p; continue; }
    const [e0, e1] = a.ends;
    const nxt = picks[i + 1];
    // come FROM the previous stop; for the FIRST stop, orient by where we go next
    const ref = prev ?? (nxt ? (nxt.ends ? nxt.ends[0] : pt(nxt)) : null);
    let entry = e0, exit = e1;
    if (ref) {
      const d0 = haversineKm(ref[0], ref[1], e0[0], e0[1]);
      const d1 = haversineKm(ref[0], ref[1], e1[0], e1[1]);
      if (prev) { if (d1 < d0) { entry = e1; exit = e0; } }   // enter at the nearer end
      else if (d0 < d1) { entry = e1; exit = e0; }            // first stop: exit toward the next
    }
    out.push({ arr: entry, dep: exit });
    prev = exit;
  }
  return out;
}

function kindOf(a: Attraction): StopKind {
  return KIND_FROM_CAT[a.category] ?? "culture";
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
    .filter((a) => !isAvoided(a, opts?.avoidCats));
  // The input is already taste-ranked; for kids, re-sort by family_score. (An active
  // anchor per family day is enforced by the critic flag + the higher family pace,
  // NOT by a ranking boost — a boost distorted must-see coverage. v1.2.)
  const pool = isFamily
    ? [...filtered].sort((a, b) => familyFit(b) - familyFit(a))
    : filtered;

  // Proximity clustering: instead of slicing the ranked list into days (which
  // scatters each day across the city), group geographically so every day is a
  // walkable neighbourhood. seedGroups (chosen-neighbourhood tour) force one day
  // per area. The per-day budget is derived from the pace.
  const dwell = opts?.dwell ?? DWELL_DEFAULT;
  const { days: clustered } = clusterIntoDays(pool, days, { walkPref, dayMinutes: perDay * 84, perDay, seedGroups,
    freeMax: opts?.freeGemMaxPerDay, freeDetour: opts?.freeGemDetourMin, dwell, center: opts?.center });

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
  const usedIds = new Set<number>();
  const capped = clustered.map((picksRaw) => {
    const picks = capTypePerDay(dropSamePlace(picksRaw, opts?.samePlaceMeters), caps);
    picks.forEach((a) => usedIds.add(a.id));
    return picks;
  });
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
    const fill = (maxKm: number) => {
      while (picks.length < perDay) {
        const cand = pool
          .filter((a) => !usedIds.has(a.id))
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

  const dayList = capped.map((pickFinal, d) => {
    // Order each day by PROXIMITY (NN + 2-opt) after cap+backfill, then ORIENT the
    // whole route so morning-leaning stops fall earlier and evening / day-ender ones
    // later — by flipping the path's direction, never by pulling a single stop out of
    // sequence. A per-stop time-of-day reshuffle used to tear a cluster apart (a
    // sunset museum sent across the IJ to the day's end, away from its neighbour). The
    // orientation keeps every adjacency intact — proximity wins, timing is a nudge.
    const picks = orientDay(orderPath(pickFinal), opts?.dayEnderLast !== false);
    const stops: Stop[] = [];
    // Sequential clock: arrival = running time, then add the stay + travel to the
    // next stop, so times always increase and reflect real durations. The lunch
    // break is dropped at the first stop boundary past noon — no fixed slots.
    const startMin = opts?.dayStartMin ?? DAY_START_MIN;
    const lunchAfter = opts?.lunchAfterMin ?? LUNCH_AFTER_MIN;
    const lunchLen = opts?.lunchMinutes ?? LUNCH_MIN;
    let clock = round30(startMin);
    let lunchDone = false;
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
      stops.push({
        name: a.name_he || a.name_en,
        kind: kindOf(a),
        time: fmtClock(arr),
        duration: durationHe(dwellMinutes(a, dwell)),
        score: isFamily ? (a.family_score ?? undefined) : undefined,
        note: a.tips_he || descriptor(a),
        // carry coords/id so between-stop travel legs + map pins work without
        // depending on a later attachDetails pass (e.g. saved modules).
        id: a.id, lat: a.lat, lng: a.lng, image: a.image_url, tagline: a.tagline_he,
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
  const tripDayObjs = clusters.slice(0, tripDays).map((cl, i) =>
    dayTripToDay(cl, city, cityDays + i + 1, isFamily, { dayStartMin: opts?.dayStartMin, dwell: opts?.dwell ?? DWELL_DEFAULT }));

  // A car_base trip is a rental-car trip throughout: mark every day so between-stop
  // legs read as driving, not public transit.
  const allDays = [...cityItin.days, ...tripDayObjs].map((d) => ({ ...d, carBase: true }));
  return {
    title: `טיול ב${city}`,
    subtitle: `${days} ימים · ${country} · כולל ${tripDays} ${tripDays === 1 ? "יום טיול ברכב" : "ימי טיול ברכב"}`,
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
