// Car "star-trip" day-trips for car_base cities (Salzburg, Brașov, the islands).
// A base town's worthy set extends 50-120km — those far places are reached by CAR
// on a dedicated day, NOT folded into a walkable in-city day. This module splits
// the pool by reach and clusters the far part into day-trip destinations.
// See docs/logic/mobility.md. Deterministic — no AI, no external API.
import type { Attraction } from "./db";
import type { Day, Stop, StopKind } from "./trip-types";
import { haversineKm } from "./geo";

// A place is "in-city" (walk/short-transit) vs a car day-trip by distance from the
// base centre. ~18km covers a metro + its immediate transit reach.
export const IN_CITY_KM = 18;
// Rural driving average for the estimate (deterministic; live nav is the deep-link).
const DRIVE_KMH = 68;
const CLUSTER_KM = 14;        // places within this of a seed form one day-trip area
const MAX_STOPS_PER_TRIP = 5; // a full day out includes a few nearby stops

const worth = (a: Attraction) =>
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
  far: Attraction[], center: { lat: number; lng: number }
): DayTripCluster[] {
  const pool = far.filter(hasCoords).sort((a, b) => worth(b) - worth(a));
  const used = new Set<number>();
  const clusters: DayTripCluster[] = [];

  for (const seed of pool) {
    if (used.has(seed.id)) continue;
    const members = pool.filter(
      (a) => !used.has(a.id) && haversineKm(seed.lat!, seed.lng!, a.lat!, a.lng!) <= CLUSTER_KM);
    members.forEach((m) => used.add(m.id));
    // order: anchor first, then nearest-neighbour walk within the far area
    const ordered = orderFromAnchor(members, seed).slice(0, MAX_STOPS_PER_TRIP);
    const lat = ordered.reduce((s, a) => s + a.lat!, 0) / ordered.length;
    const lng = ordered.reduce((s, a) => s + a.lng!, 0) / ordered.length;
    const driveKm = Math.round(haversineKm(center.lat, center.lng, lat, lng));
    clusters.push({ stops: ordered, lat, lng, driveKm, driveMin: driveMin(driveKm), anchor: seed });
  }
  // rank day-trips by the worth they deliver (anchor pull + supporting stops)
  return clusters.sort((a, b) =>
    (worth(b.anchor) + b.stops.length) - (worth(a.anchor) + a.stops.length));
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
const SLOT_TIMES = ["10:00", "12:30", "14:30", "16:00", "17:30"];

// Turn one cluster into a full day-trip Day (car leg + its stops).
export function dayTripToDay(cl: DayTripCluster, base: string, dayNum: number, isFamily: boolean): Day {
  const anchorName = cl.anchor.name_he || cl.anchor.name_en;
  const stops: Stop[] = cl.stops.map((a, i) => ({
    name: a.name_he || a.name_en,
    kind: KIND_FROM_CAT[a.category] ?? "culture",
    time: SLOT_TIMES[Math.min(i, SLOT_TIMES.length - 1)],
    duration: a.duration_minutes ? `${Math.round(a.duration_minutes / 60)} שעות` : "1.5 שעות",
    score: isFamily ? (a.family_score ?? undefined) : undefined,
    note: a.tips_he || a.tagline_he || undefined,
    id: a.id, lat: a.lat, lng: a.lng, image: a.image_url, tagline: a.tagline_he,
  }));
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

// How many of N days to spend on car day-trips: leave the majority in-city, cap by
// available clusters. 3d→1, 4-5d→2, 6-7d→3, and never more than half.
export function dayTripBudget(totalDays: number, availableClusters: number): number {
  const byDays = Math.floor((totalDays - 1) / 2);
  return Math.max(0, Math.min(byDays, availableClusters, Math.floor(totalDays / 2)));
}
