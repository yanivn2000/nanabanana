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

export type Leg = {
  km: number;
  walkMin: number;
  transitMin: number;
  recommended: "walk" | "transit";
  icon: string;      // 🚶 | 🚌
  primaryHe: string; // leading suggestion
  altHe?: string;    // the other option, shown when it's a genuine toss-up
};

// Estimate the leg between two stops given the traveler's walk tolerance. Walk is
// exact-ish (haversine); transit is a deterministic placeholder (fixed overhead +
// line-haul) until real GTFS/OTP numbers replace it. Public-transport carries a
// ~11-min fixed cost (walk to stop + wait ½-headway + walk from stop), so short
// hops are almost always better on foot — which is why the Amsterdam-centre →
// Albert-Cuyp kind of hop reads as a toss-up rather than an automatic tram.
export function estimateLeg(
  lat1: number, lng1: number, lat2: number, lng2: number, walkPref = DEFAULT_WALK_PREF
): Leg {
  const km = haversineKm(lat1, lng1, lat2, lng2);
  const walkMin = Math.max(1, Math.round(km * WALK_MIN_PER_KM));
  const transitMin = Math.round(11 + (km / 20) * 60);
  const maxWalk = WALK_PREF_KM[walkPref] ?? WALK_PREF_KM[DEFAULT_WALK_PREF];
  const recommended: "walk" | "transit" = km <= maxWalk ? "walk" : "transit";

  if (recommended === "walk") {
    // Offer transit as an alt only when the walk is on the longer side for this
    // traveler (>60% of their tolerance) — otherwise just say "walk".
    const alt = km > maxWalk * 0.6 ? `או תחבורה ציבורית · ~${transitMin} דק׳` : undefined;
    return { km, walkMin, transitMin, recommended, icon: "🚶", primaryHe: `${walkMin} דק׳ הליכה`, altHe: alt };
  }
  // Transit leads; still offer to walk if it isn't wildly far (< 2× tolerance).
  const alt = km < maxWalk * 2 ? `או ${walkMin} דק׳ הליכה` : undefined;
  return { km, walkMin, transitMin, recommended, icon: "🚌", primaryHe: `תחבורה ציבורית · ~${transitMin} דק׳`, altHe: alt };
}
