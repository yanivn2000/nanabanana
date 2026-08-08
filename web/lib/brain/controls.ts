// DOES THE CONTROL DO ANYTHING?
//
// The distance slider ("מרחק נסיעה ליום") shipped and looked like a feature for
// weeks while reaching nothing but the AI prompt — which is off. The budget
// selector still does. Both were found by hand, once, by accident. This turns
// that hand-check into something the Brain runs on itself.
//
// Method (docs/logic/build-inputs.md): build the same city twice with a FIXED
// seed, changing one input. The seed is what makes it valid — without it the
// best-of-N lottery makes every build differ and nothing can be concluded. If
// the stop list is byte-identical, the control did nothing.
//
// Each probe declares the cities where it CAN bite. driveHours cannot change a
// metro city that has no car day-trips, and calling that a failure would train
// the editor to ignore this section — the most expensive thing a check can do.
import type { Itinerary } from "../trip-types";

export type ControlProbe = {
  key: string;
  he: string;
  /** Extra body fields for the variant build. */
  variant: Record<string, unknown>;
  /** Only meaningful on these mobility kinds; undefined = both. */
  mobility?: "metro" | "car_base";
  /** Why it matters, shown when it fails. */
  why: string;
};

// Each probe says what to change relative to the CURRENT build, not an absolute
// value — probing "families" while already building families proves nothing, and
// a first cut that did exactly that reported the audience control dead on every
// family row. A checker that cries wolf teaches the editor to ignore it.
export const CONTROL_PROBES: ControlProbe[] = [
  { key: "audience", he: "קהל (עם/בלי ילדים)", variant: { flipAudience: true },
    why: "ההבטחה המרכזית של המוצר — טיול שמתאים למי שנוסע" },
  { key: "pace", he: "קצב", variant: { paceStops: 3 },
    why: "כמה עצירות ביום — הבורר הכי מורגש בטיול" },
  { key: "walkPref", he: "מרחק הליכה", variant: { walkPref: 1 },
    why: "רדיוס היום; מי שביקש מעט הליכה לא אמור לקבל יום מפוזר" },
  { key: "taste", he: "טעם (תגיות)", variant: { taste: { nature: 9, history: -9, art: -9 } },
    why: "ההתאמה האישית — בלעדיו כולם מקבלים את אותו טיול" },
  { key: "driveHours", he: "מרחק נסיעה ליום", variant: { maxDriveMin: 30 }, mobility: "car_base",
    why: "מי שביקש 'ממש קרוב' לא אמור לקבל נסיעה של שעתיים" },
];

export type ControlResult = { key: string; he: string; live: boolean; why: string; skipped?: boolean };

/** A build's identity for comparison: the ordered stop names of every day. */
export const tripSignature = (it: Itinerary): string =>
  it.days.map((d) => d.stops.filter((s) => s.id != null).map((s) => s.name).join("|")).join("//");

export function controlVerdicts(
  base: Itinerary,
  variants: { probe: ControlProbe; itinerary: Itinerary | null }[],
): ControlResult[] {
  const baseSig = tripSignature(base);
  return variants.map(({ probe, itinerary }) => ({
    key: probe.key, he: probe.he, why: probe.why,
    live: itinerary ? tripSignature(itinerary) !== baseSig : false,
    ...(itinerary ? {} : { skipped: true }),
  }));
}

// THE VERDICT IS GLOBAL, NOT PER-CITY. Wiring is the same code for every city, so
// one city where the control could not bite proves nothing: Rome's adult days are
// already tight enough that walkPref=1 changes nothing, and Salzburg's ~30-place
// adult pool re-ranks to the same top 90 under any taste. Judging per row would
// paint ❌ on thin cities forever and teach the editor to scroll past this
// section. A control is dead only when NO city, in EITHER audience, moved.
export function globalControlVerdicts(rows: ControlResult[][]): ControlResult[] {
  const byKey = new Map<string, ControlResult>();
  for (const row of rows) {
    for (const c of row) {
      const prev = byKey.get(c.key);
      if (!prev) { byKey.set(c.key, { ...c }); continue; }
      // live anywhere → live; skipped everywhere → skipped
      if (c.live) prev.live = true;
      if (!c.skipped) prev.skipped = false;
    }
  }
  return [...byKey.values()];
}

/** 6 points per dead control, capped — a global product failure, priced into
 *  every trip's score so the average drops until it is fixed. */
export const controlPenalty = (verdicts: ControlResult[]): number =>
  Math.min(18, verdicts.filter((c) => !c.live && !c.skipped).length * 6);
