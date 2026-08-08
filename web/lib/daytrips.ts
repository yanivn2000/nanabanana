// Car "star-trip" day-trips for car_base cities (Salzburg, Brașov, the islands).
// A base town's worthy set extends 50-120km — those far places are reached by CAR
// on a dedicated day, NOT folded into a walkable in-city day. This module splits
// the pool by reach and clusters the far part into day-trip destinations.
// See docs/logic/mobility.md. Deterministic — no AI, no external API.
import type { Attraction } from "./db";
import type { Day, Stop, StopKind } from "./trip-types";
import { haversineKm, durationHe, walkMinutes } from "./geo";
import { dropSamePlace } from "./cluster";
import { DWELL_DEFAULT, dwellMinutes, orientDay, type DwellCfg } from "./brain/traits";

const fmtClock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// A place is "in-city" (walk/short-transit) vs a car day-trip by distance from the
// base centre. ~18km covers a metro + its immediate transit reach.
export const IN_CITY_KM = 18;
// Rural driving average for the estimate (deterministic; live nav is the deep-link).
const DRIVE_KMH = 68;
const CLUSTER_KM = 14;        // places within this of a seed form one day-trip area
const MAX_STOPS_PER_TRIP = 5; // a full day out includes a few nearby stops

const worth = (a: Attraction) =>
  (a.pool_tier === 2 ? -2000 : 0) +          // fillers never anchor a day out
  (a.must_see === 1 ? 1000 : 0) +
  Math.max(a.audience_fit?.families ?? 0, a.audience_fit?.couples ?? 0, a.audience_fit?.friends ?? 0);

const hasCoords = (a: Attraction): a is Attraction & { lat: number; lng: number } =>
  Number.isFinite(a.lat) && Number.isFinite(a.lng);

export type DayTripCluster = {
  stops: Attraction[];        // ordered, anchor first
  lat: number; lng: number;   // cluster centroid
  driveKm: number; driveMin: number;
  anchor: Attraction;         // best-known stop, names the trip
};

// Split a ranked pool into what's walkable from the base vs what needs a car.
export function splitByReach(
  attractions: Attraction[], center: { lat: number; lng: number }, inCityKm = IN_CITY_KM
): { inCity: Attraction[]; far: Attraction[] } {
  const inCity: Attraction[] = [], far: Attraction[] = [];
  for (const a of attractions) {
    if (hasCoords(a) && haversineKm(center.lat, center.lng, a.lat, a.lng) > inCityKm) far.push(a);
    else inCity.push(a);
  }
  return { inCity, far };
}

const driveMin = (km: number) => Math.round(km / DRIVE_KMH * 60) + 8; // +8 park/approach

// Greedily group far attractions into day-trip clusters: seed on the worthiest
// unused place, gather everything within CLUSTER_KM, order the stops as a short
// path from the anchor. Returns clusters ranked by total worth.
export function clusterDayTrips(
  far: Attraction[], center: { lat: number; lng: number },
  opts: { maxStops?: number; sameMeters?: number } = {}
): DayTripCluster[] {
  const maxStops = opts.maxStops ?? MAX_STOPS_PER_TRIP;
  const pool = far.filter(hasCoords).sort((a, b) => worth(b) - worth(a));
  const used = new Set<number>();
  const clusters: DayTripCluster[] = [];

  for (const seed of pool) {
    if (used.has(seed.id)) continue;
    const members = pool.filter(
      (a) => !used.has(a.id) && haversineKm(seed.lat!, seed.lng!, a.lat!, a.lng!) <= CLUSTER_KM);
    members.forEach((m) => used.add(m.id));
    // order: anchor first, then nearest-neighbour walk within the far area; drop
    // "same place" stops (a lake and its own dock/viewpoint), then orient so an
    // evening / day-ender stop leans late without tearing the proximity path.
    // The anchor is the REASON this day out exists, so it must survive the trim.
    // It did not: Crete's Elafonissi day came back as five unnamed beaches with
    // no Elafonissi in it — orientDay moves a day-ender late, and slice() then
    // cut the anchor off the front. Invisible until tier-2 fillers swelled
    // clusters past maxStops; the day was named for a place it no longer visited.
    const path = orientDay(dropSamePlace(orderFromAnchor(members, seed), opts.sameMeters));
    let ordered = path.slice(0, maxStops);
    if (!ordered.some((s) => s.id === seed.id)) {
      const rest = path.filter((s) => s.id !== seed.id && hasCoords(s)).slice(0, maxStops - 1);
      ordered = orientDay(orderFromAnchor([seed, ...rest as (typeof seed)[]], seed));
    }
    const lat = ordered.reduce((s, a) => s + a.lat!, 0) / ordered.length;
    const lng = ordered.reduce((s, a) => s + a.lng!, 0) / ordered.length;
    const driveKm = Math.round(haversineKm(center.lat, center.lng, lat, lng));
    clusters.push({ stops: ordered, lat, lng, driveKm, driveMin: driveMin(driveKm), anchor: seed });
  }
  // Rank day-trips by the worth they deliver: the anchor's pull, plus the number
  // of REAL supporting stops. Counting tier-2 fillers here cost Crete its
  // Elafonissi day — five unnamed beaches on the Gramvousa peninsula formed a
  // 5-stop cluster that out-ranked Elafonissi's 2-stop one purely on size, and
  // the trip spent two of its four days on the same headland. A filler may pad a
  // day out; it may not be the reason a day out is chosen.
  const pull = (c: DayTripCluster) =>
    worth(c.anchor) + c.stops.filter((s) => s.pool_tier !== 2).length;
  return clusters.sort((a, b) => pull(b) - pull(a));
}

// Nearest-neighbour order starting at the anchor (a tight route within the area).
function orderFromAnchor(members: (Attraction & { lat: number; lng: number })[], anchor: Attraction): Attraction[] {
  const rest = members.filter((m) => m.id !== anchor.id);
  const out: Attraction[] = [anchor];
  let cur = anchor;
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((m, i) => { const d = haversineKm(cur.lat!, cur.lng!, m.lat!, m.lng!); if (d < bd) { bd = d; bi = i; } });
    cur = rest.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

const KIND_FROM_CAT: Record<string, StopKind> = {
  nature: "nature", museum: "culture", attraction: "culture", sport: "nature",
  food: "food", shopping: "shopping", historic: "culture", tourism: "culture", leisure: "nature",
};
// Turn one cluster into a full day-trip Day (car leg + its stops). Uses the same
// sequential clock as in-city days (respecting the day_window / visit_default
// techniques via `sched`), offset by the drive out — no fixed slots.
// A one-stop day trip is not a day (the owner's Salzburg day 4 was Schafberg
// alone with 24 places waiting in the bank). Before giving a thin cluster a
// whole day, widen it twice, geography permitting:
//   1. ON THE WAY — unused far attractions whose detour off the center→anchor
//      drive is small. A car day absorbs these for free.
//   2. Around the anchor at a car-day radius (a car reaches in 15 minutes what
//      a walking day never would).
// Deliberately NOT filling to the cap when the day is already ≥min: this rescues
// broken days, it does not stuff good ones.
export function widenThinCluster(
  cl: DayTripCluster, unused: Attraction[], center: { lat: number; lng: number },
  min = 2, maxStops = MAX_STOPS_PER_TRIP,
): DayTripCluster {
  if (cl.stops.length >= min) return cl;
  const have = new Set(cl.stops.map((s) => s.id));
  const anchor = cl.anchor;
  const direct = haversineKm(center.lat, center.lng, anchor.lat as number, anchor.lng as number);
  const cands = unused
    .filter((a) => !have.has(a.id) && hasCoords(a))
    .map((a) => {
      const legOut = haversineKm(center.lat, center.lng, a.lat as number, a.lng as number);
      const legOn = haversineKm(a.lat as number, a.lng as number, anchor.lat as number, anchor.lng as number);
      return { a, detourKm: legOut + legOn - direct, nearKm: legOn };
    })
    // Car-day geometry: a 20km detour is ~15 minutes behind the wheel, and a
    // second site 25km from the anchor is still one comfortable outing. Tighter
    // thresholds left Brasov's Bucegi day at one stop with Dino Park sitting in
    // the bank 25km away.
    .filter((x) => x.detourKm <= 20 || x.nearKm <= 25)
    .sort((x, y) => (worth(y.a) - worth(x.a)) || (x.nearKm - y.nearKm));
  const extra = cands.slice(0, maxStops - cl.stops.length).map((x) => x.a);
  if (!extra.length) return cl;
  const members = [...cl.stops, ...extra] as (Attraction & { lat: number; lng: number })[];
  const ordered = orientDay(orderFromAnchor(members, anchor)).slice(0, maxStops);
  const lat = ordered.reduce((s, a) => s + (a.lat as number), 0) / ordered.length;
  const lng = ordered.reduce((s, a) => s + (a.lng as number), 0) / ordered.length;
  const driveKm = Math.round(haversineKm(center.lat, center.lng, lat, lng));
  return { ...cl, stops: ordered, lat, lng, driveKm, driveMin: driveMin(driveKm) };
}

export function dayTripToDay(
  cl: DayTripCluster, base: string, dayNum: number, isFamily: boolean,
  sched: { dayStartMin?: number; dwell?: DwellCfg } = {}
): Day {
  const anchorName = cl.anchor.name_he || cl.anchor.name_en;
  const dwell = sched.dwell ?? DWELL_DEFAULT;
  let clock = (sched.dayStartMin ?? 9 * 60 + 30) + cl.driveMin;   // drive out first
  const stops: Stop[] = cl.stops.map((a, i) => {
    const time = fmtClock(clock);
    clock += dwellMinutes(a, dwell);
    const next = cl.stops[i + 1];
    if (next && [a.lat, a.lng, next.lat, next.lng].every((v) => Number.isFinite(v)))
      clock += walkMinutes(haversineKm(a.lat as number, a.lng as number, next.lat as number, next.lng as number));
    return {
      name: a.name_he || a.name_en,
      kind: KIND_FROM_CAT[a.category] ?? "culture",
      time,
      duration: durationHe(dwellMinutes(a, dwell)),
      score: isFamily ? (a.family_score ?? undefined) : undefined,
      note: a.tips_he || a.tagline_he || undefined,
      id: a.id, lat: a.lat, lng: a.lng, image: a.image_url, tagline: a.tagline_he,
    };
  });
  return {
    label: `יום ${dayNum}`,
    date: "",
    base,
    area: anchorName,
    why: `יום טיול ברכב מ${base} אל ${anchorName} — כ-${cl.driveKm} ק״מ (~${cl.driveMin} דק׳ נסיעה לכל כיוון). ${cl.stops.length} עצירות באזור.`,
    dayTrip: { driveMin: cl.driveMin, driveKm: cl.driveKm, anchorLat: cl.anchor.lat, anchorLng: cl.anchor.lng },
    stops,
  };
}

// How many of N days to spend on car day-trips. A base town's whole point is the
// day-trips, so roughly half the days go out by car — but always keep ≥1 in-city
// day and never exceed the available clusters. 2d→1, 3d→1, 4d→2, 5d→2, 6d→3, 7d→3.
export function dayTripBudget(totalDays: number, availableClusters: number, perDays = 2): number {
  const byDays = Math.floor(totalDays / Math.max(1, perDays));
  return Math.max(0, Math.min(byDays, availableClusters, totalDays - 1));
}
