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
import { entryExit, type LatLng } from "./access";
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
  // Interest/must-see reservation (from the build route): these ids are pinned to
  // the FRONT of the pool so the family familyFit re-sort can't drop the icons.
  reservedIds?: Set<number>;
  // Chosen-theme stops the proximity clusterer tends to drop because they're
  // geographically scattered (nightlife bars, peripheral parks). After clustering,
  // the best few unscheduled ones are force-inserted into their nearest day so a
  // chosen theme is never absent just because its venues aren't centrally located.
  guaranteeIds?: Set<number>;
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
    .filter((a) => !isAvoided(a, opts?.avoidCats));
  // The input is already taste-ranked; for kids, re-sort by family_score. (An active
  // anchor per family day is enforced by the critic flag + the higher family pace,
  // NOT by a ranking boost — a boost distorted must-see coverage. v1.2.) The route's
  // interest/must-see reservation is pinned first (targeted floor of ~days+K stops),
  // so the family re-sort keeps the icons in the candidate window without a blanket
  // must-see boost.
  const rsv = opts?.reservedIds;
  const poolAll = isFamily
    ? [...filtered].sort((a, b) =>
        (Number(rsv?.has(b.id) ?? false) - Number(rsv?.has(a.id) ?? false)) || (familyFit(b) - familyFit(a)))
    : filtered;

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

  const usedNight = new Set<number>();   // chosen nightlife venues already placed as an evening slot
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
    if (nightVenues.length && picks.length) {
      const last = picks[picks.length - 1];
      const cand = nightVenues
        .filter((v) => !usedNight.has(v.id))
        .map((v) => ({ v, km: haversineKm(last.lat as number, last.lng as number, v.lat as number, v.lng as number) }))
        .sort((x, y) => x.km - y.km)[0];
      if (cand) {
        usedNight.add(cand.v.id);
        const v = cand.v;
        const nightClock = Math.max(round30(clock) + 60, 20 * 60 + 30);   // after the day, ≥ 20:30
        stops.push({
          name: v.name_he || v.name_en, kind: kindOf(v), time: fmtClock(nightClock),
          duration: durationHe(dwellMinutes(v, dwell)), note: v.tips_he || descriptor(v),
          id: v.id, lat: v.lat, lng: v.lng, image: v.image_url, tagline: v.tagline_he,
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
