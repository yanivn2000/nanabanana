// The Brain — attraction TRAITS (deterministic classifiers, no AI). Digested from
// editor notes into the build policy. See docs/logic/brain.md.
//   - day-enders: high-energy/water/adventure stops that leave everyone spent, so
//     they belong LAST in a day (editor note: "ואצמן/פארקי-שעשועים לסיום יום").
//   - active anchors: the one fun/active thing an Israeli family day must include
//     (editor note: "ילדים ישראלים חייבים אטרקציה פעילה — רכבל/מזחלות/קניון/בריכה").
//   - seasonality: some places only make sense in one season (editor note: "זירת
//     הקרח = חורף; בקיץ לא רלוונטי" — season is a required build input).
import type { Attraction } from "../db";

const blob = (a: Attraction) => `${a.name_he ?? ""} ${a.name_en ?? ""} ${a.subcategory ?? ""} ${a.category ?? ""}`.toLowerCase();

const DAY_ENDER_RX = /water_park|theme_park|amusement|alpine_coaster|summer_toboggan|toboggan|luge|swimming|pool|lido|aquapark|בריכ|מזחל|לונה.?פארק|פארק מים|וו?אטר.?פארק|ריזנראד|גלגל ענק/i;
const ACTIVE_RX = /cable_car|gondola|funicular|רכבל|alpine_coaster|toboggan|מזחל|water_park|פארק מים|theme_park|לונה.?פארק|zoo|גן ?חיות|aquarium|אקווריום|gorge|קניון|נקיק|cave|מער(ה|ות|ת)|beach|חוף|בריכ|pool|adventure|הרפתק|קארט|gokart|רפטינג|zipline|אומגה/i;
const WINTER_RX = /ice_rink|ice.?arena|bobsled|luge.?track|\bski\b|sled|זירת הקרח|החלקה על הקרח|סקי|מזחלות שלג|christmas.?market|שוק חג המולד|גלישה על שלג/i;
const SUMMER_RX = /water_park|swimming|\bpool\b|lido|strandbad|פארק מים|בריכ|חוף רחצה|שמורת רחצה/i;

export const isDayEnder = (a: Attraction) => DAY_ENDER_RX.test(blob(a));
export const isActiveAnchor = (a: Attraction) => ACTIVE_RX.test(blob(a));

export type Season = "winter" | "summer" | "shoulder";
export function seasonOf(month?: number | null): Season | null {
  if (!month) return null;
  if ([12, 1, 2].includes(month)) return "winter";
  if ([6, 7, 8].includes(month)) return "summer";
  return "shoulder";
}
// Keep a stop only if it fits the trip's season. Winter-only places drop outside
// winter; summer-only (water) places drop in winter. Unknown season → keep all.
export function isInSeason(a: Attraction, month?: number | null): boolean {
  const s = seasonOf(month);
  if (!s) return true;
  const t = blob(a);
  if (WINTER_RX.test(t) && s !== "winter") return false;
  if (SUMMER_RX.test(t) && s === "winter") return false;
  return true;
}

// Stable reorder: keep everything in route order, but push day-enders to the end.
export function reorderDayEnders(day: Attraction[]): Attraction[] {
  const rest = day.filter((a) => !isDayEnder(a));
  const enders = day.filter((a) => isDayEnder(a));
  return [...rest, ...enders];
}
