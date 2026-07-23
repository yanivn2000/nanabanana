// Distance helpers shared by client and server (no server-only deps).

export function haversineKm(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} מ׳`;
  if (km < 10) return `${km.toFixed(1)} ק״מ`;
  return `${Math.round(km)} ק״מ`;
}

// Navigation deep links — open in the traveler's preferred maps app.
export function wazeUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}
export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
// Live navigation between two points, in the traveler's chosen transit mode. This
// is the "day-of" link (fresh, real-time) that complements our pre-planned leg —
// deep-linking is allowed where storing directions results is not.
export function googleDirUrl(
  fromLat: number, fromLng: number, toLat: number, toLng: number,
  mode: "walking" | "transit" | "driving" = "walking"
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}` +
    `&destination=${toLat},${toLng}&travelmode=${mode}`;
}

// --- Getting from A to B ("how do I move between stops") ----------------------
// The traveler's walk tolerance (1-5) → the max straight-line km they'll walk
// before we suggest transit. Feeds both the itinerary leg hints and the builder.
export const WALK_PREF_KM: Record<number, number> = { 1: 0.5, 2: 1.0, 3: 1.5, 4: 2.5, 5: 4.0 };
export const WALK_PREF_LABEL_HE: Record<number, string> = {
  1: "כמה שפחות ברגל", 2: "מעדיף תחבורה", 3: "מאוזן", 4: "אוהב ללכת", 5: "רגל בכל הזדמנות",
};
export const DEFAULT_WALK_PREF = 3;

// Walking ~4.8 km/h ≈ 12.5 min/km, ×1.3 because real streets are longer than the
// straight line haversine measures. Kept deterministic — no routing API.
const WALK_MIN_PER_KM = 12.5 * 1.3;

// Minutes on foot for a straight-line distance in km. The single walk-speed
// model shared by the leg hints and the day clusterer.
export function walkMinutes(km: number): number {
  return Math.max(1, Math.round(km * WALK_MIN_PER_KM));
}

// Between-stop travel time (minutes): walk for short hops, but public transit
// for long ones — you don't WALK 12km back from Richmond, you take the tube
// (~45min, not ~3h). The single travel-time model shared by BOTH the builder
// (heuristic.ts) and the deterministic editor (revise-heuristic.ts) so a day
// re-timed after an edit matches the day as first built.
export function travelMinutes(km: number): number {
  const walk = walkMinutes(km);
  const transit = km <= 1 ? walk : 12 + (km / 22) * 60;   // access + wait + ~22km/h ride
  return Math.round(Math.min(walk, transit));
}

// Recommended visit length in natural Hebrew — never "0 שעות" for sub-hour stops.
// The single source of truth for stop durations across the builders.
export function durationHe(minutes: number | null | undefined): string {
  const m = Math.max(20, Math.round(minutes || 90));
  if (m < 38) return "כחצי שעה";
  if (m < 53) return "כ-45 דק׳";
  const h = m / 60;
  if (h < 1.25) return "כשעה";
  if (h < 1.75) return "כשעה וחצי";
  if (h < 2.25) return "כשעתיים";
  if (h < 2.75) return "כשעתיים וחצי";
  return `כ-${Math.round(h)} שעות`;
}

export type Leg = {
  km: number;
  walkMin: number;
  transitMin: number;
  driveMin: number;
  recommended: "walk" | "transit" | "drive";
  icon: string;      // 🚶 | 🚌 | 🚗
  primaryHe: string; // leading suggestion
  altHe?: string;    // the other option, shown when it's a genuine toss-up
};

// Minutes by car for a short local leg — ~32 km/h effective (local roads, parking,
// approach), a deterministic placeholder like the transit one. Rental-car trips
// (car_base cities) use this instead of public transit.
export function localDriveMin(km: number): number {
  return Math.max(4, Math.round(km / 32 * 60) + 3);
}

// Estimate the leg between two stops given the traveler's walk tolerance. Walk is
// exact-ish (haversine); transit is a deterministic placeholder (fixed overhead +
// line-haul) until real GTFS/OTP numbers replace it. Public-transport carries a
// ~11-min fixed cost (walk to stop + wait ½-headway + walk from stop), so short
// hops are almost always better on foot — which is why the Amsterdam-centre →
// Albert-Cuyp kind of hop reads as a toss-up rather than an automatic tram.
export function estimateLeg(
  lat1: number, lng1: number, lat2: number, lng2: number, walkPref = DEFAULT_WALK_PREF,
  car = false
): Leg {
  const km = haversineKm(lat1, lng1, lat2, lng2);
  const walkMin = walkMinutes(km);
  const transitMin = Math.round(11 + (km / 20) * 60);
  const driveMin = localDriveMin(km);
  const maxWalk = WALK_PREF_KM[walkPref] ?? WALK_PREF_KM[DEFAULT_WALK_PREF];
  const recommended: "walk" | "transit" | "drive" =
    km <= maxWalk ? "walk" : car ? "drive" : "transit";

  if (recommended === "walk") {
    // Offer the vehicle alt only when the walk is on the longer side for this
    // traveler (>60% of their tolerance) — otherwise just say "walk".
    const alt = km > maxWalk * 0.6
      ? (car ? `או נסיעה קצרה ברכב · ~${driveMin} דק׳` : `או תחבורה ציבורית · ~${transitMin} דק׳`)
      : undefined;
    return { km, walkMin, transitMin, driveMin, recommended, icon: "🚶", primaryHe: `${walkMin} דק׳ הליכה`, altHe: alt };
  }
  // Vehicle leads; still offer to walk if it isn't wildly far (< 2× tolerance).
  const alt = km < maxWalk * 2 ? `או ${walkMin} דק׳ הליכה` : undefined;
  if (recommended === "drive") {
    return { km, walkMin, transitMin, driveMin, recommended, icon: "🚗", primaryHe: `נסיעה ברכב · ~${driveMin} דק׳`, altHe: alt };
  }
  return { km, walkMin, transitMin, driveMin, recommended, icon: "🚌", primaryHe: `תחבורה ציבורית · ~${transitMin} דק׳`, altHe: alt };
}
