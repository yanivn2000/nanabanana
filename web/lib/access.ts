// The ACCESS-POINT contract — the single place that knows how a route touches a
// stop. The planner stops asking "what are the lat/lng of X" and asks "how do I
// get INTO and OUT of X". A stop becomes a black box with ports:
//
//   point (attraction) → one port; enter = exit = it.
//   line  (street)      → two ports (its ends); enter at the end nearer where you
//                         came from, exit from the other — the walk along the
//                         street is DWELL, not travel.
//   zone  (future)      → its gateway (metro entrance) as the single port.
//
// Centralising this here means a 4th kind joins by teaching one function, not by
// special-casing the clusterer and the timer (which is where it lived before).
import type { Attraction } from "./db";

export type LatLng = [number, number];

// A stop's geometry, derived from what it carries. Real attractions are points;
// a synthetic street stop carries `ends`.
export function accessPoints(a: Attraction): LatLng[] {
  if (a.ends) return [a.ends[0], a.ends[1]];
  if (a.lat != null && a.lng != null) return [[a.lat, a.lng]];
  return [];
}

const hav = (p: LatLng, q: LatLng): number => {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLa = rad(q[0] - p[0]), dLo = rad(q[1] - p[1]);
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(rad(p[0])) * Math.cos(rad(q[0])) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

// Straight-line km between two stops = the CLOSEST pair of their access points,
// so a long street reads as NEAR when either end is near (not measured from its
// far midpoint). Undefined coords → Infinity so they sort last, never crash.
export function gapKm(a: Attraction, b: Attraction): number {
  const pa = accessPoints(a), pb = accessPoints(b);
  if (!pa.length || !pb.length) return Infinity;
  let best = Infinity;
  for (const p of pa) for (const q of pb) { const d = hav(p, q); if (d < best) best = d; }
  return best;
}

// Given where you came FROM and where you go TO, resolve a stop's concrete
// ENTER and EXIT ports. A point is both. A line is entered at the end nearer the
// previous stop and left from the other; the first stop of a day orients toward
// the next instead. Pure — the timer and the clusterer both call this.
export function entryExit(a: Attraction, from: LatLng | null, to: LatLng | null): { enter: LatLng; exit: LatLng } {
  const pts = accessPoints(a);
  if (pts.length <= 1) { const p = pts[0]; return { enter: p, exit: p }; }
  const [e0, e1] = pts;
  const ref = from ?? to;
  if (!ref) return { enter: e0, exit: e1 };
  const near0 = hav(ref, e0) <= hav(ref, e1);
  // enter at the end nearer `from`; if we only have `to` (first stop), EXIT toward it.
  return from ? (near0 ? { enter: e0, exit: e1 } : { enter: e1, exit: e0 })
              : (near0 ? { enter: e1, exit: e0 } : { enter: e0, exit: e1 });
}
