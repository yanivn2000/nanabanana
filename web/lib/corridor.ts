// Corridor pass (streets step 4a, slice 1 — ADDITIVE, no timing change).
//
// A street is a corridor: the attractions along it are what you pass while
// walking it. This pass, run AFTER a day is built and timed, does two things
// without touching the schedule:
//   1. tags each scheduled attraction that sits on a scheduled street as a
//      corridor member (streetRef + how far along) → the UI nests it under the
//      street ("על פרינסנחראכט · 20%").
//   2. gives a scheduled street its "on the way" list — the notable places you
//      pass whether or not you go IN (the "just enjoy the street, see Anne Frank
//      from outside" case). dwell stays independent: the street's dwell is the
//      stroll, the attraction's dwell is the visit — never merged.
//
// Span-trimming + re-timing (which DO move the clock) are slice 2, done inside
// the builder.
import type { Itinerary } from "./trip-types";
import type { OnStreet, Street } from "./db";
import { parseRef } from "./place";

export function corridorize(itin: Itinerary, streets: Street[], onStreet: OnStreet[]): void {
  if (!streets.length) return;
  const nameById = new Map(streets.map((s) => [s.id, s.name_he || s.name_en]));
  // street id → (attraction id → pos_pct along the street)
  const membersByStreet = new Map<number, Map<number, number>>();
  // street id → notable names along it, in walking order (for the "on the way" list)
  const notableByStreet = new Map<number, { id: number; name: string; pos: number; must: boolean }[]>();
  for (const r of onStreet) {
    (membersByStreet.get(r.street_id) ?? membersByStreet.set(r.street_id, new Map()).get(r.street_id)!)
      .set(r.attraction_id, r.pos_pct);
    (notableByStreet.get(r.street_id) ?? notableByStreet.set(r.street_id, []).get(r.street_id)!)
      .push({ id: r.attraction_id, name: r.name_he || r.name_en, pos: r.pos_pct, must: r.must_see === 1 });
  }

  for (const day of itin.days) {
    // which streets are scheduled in this day (ref "street:<id>")
    const dayStreetIds = new Set<number>();
    for (const s of day.stops) {
      if (s.ref?.startsWith("street:")) dayStreetIds.add(parseRef(s.ref as `street:${number}`).id);
    }
    if (!dayStreetIds.size) continue;
    const scheduledAttrIds = new Set(day.stops.filter((s) => s.id != null && s.ref?.startsWith("attr:")).map((s) => s.id!));

    // 1) tag scheduled attractions that lie on a scheduled street
    for (const s of day.stops) {
      if (s.id == null || !s.ref?.startsWith("attr:")) continue;
      for (const sid of dayStreetIds) {
        const pos = membersByStreet.get(sid)?.get(s.id);
        if (pos != null) { s.corridor = { streetRef: `street:${sid}`, name: nameById.get(sid) ?? "", posPct: pos }; break; }
      }
    }
    // 2) the street's "on the way" list — notable spots you pass (must-sees, or
    //    ones already scheduled), so a street-only day still surfaces them.
    for (const s of day.stops) {
      if (!s.ref?.startsWith("street:")) continue;
      const sid = parseRef(s.ref as `street:${number}`).id;
      const along = (notableByStreet.get(sid) ?? [])
        .filter((m) => m.must || scheduledAttrIds.has(m.id))
        .sort((a, b) => a.pos - b.pos)
        .map((m) => m.name);
      if (along.length) s.onWay = [...new Set(along)];
    }
  }
}
