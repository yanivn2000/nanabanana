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
// "Active/fun" anchor — the one thing that isn't a sit-and-look stop. Covers BOTH
// nature/adventure (cable-car, toboggan, gorge…) AND metro/city kid-fun (aquarium,
// zoo, observation wheel, city farm, boat trip, funfair, interactive experience) —
// a city like London delivers "fun" differently from Salzburg.
const ACTIVE_RX = /cable_car|gondola|funicular|רכבל|alpine_coaster|toboggan|מזחל|water_park|פארק מים|theme_park|לונה.?פארק|zoo|גן ?חיות|aquarium|אקווריום|sea.?life|gorge|קניון|נקיק|cave|מער(ה|ות|ת)|beach|חוף|בריכ|pool|adventure|הרפתק|קארט|gokart|רפטינג|zipline|אומגה|observation.?wheel|ferris|london.?eye|עין הענק|גלגל.?ענק|\bfarm\b|city.?farm|משק |חוות|\bboat\b|cruise|שיט |שייט|הפלגה|dungeon|מבוך|tussauds|שעווה|planetarium|פלנטריום|playground|מגרש.?משחקים|funfair|יריד/i;
const WINTER_RX = /ice_rink|ice.?arena|bobsled|luge.?track|\bski\b|sled|זירת הקרח|החלקה על הקרח|סקי|מזחלות שלג|christmas.?market|שוק חג המולד|גלישה על שלג/i;
const SUMMER_RX = /water_park|swimming|\bpool\b|lido|strandbad|פארק מים|בריכ|חוף רחצה|שמורת רחצה/i;

export const isDayEnder = (a: Attraction) => DAY_ENDER_RX.test(blob(a));
export const isActiveAnchor = (a: Attraction) => ACTIVE_RX.test(blob(a));

// A "soft" kid pleaser — a big green space or a headline must-see attraction (a castle,
// the Tower of London, a fortress). Counts as an engaging day-anchor alongside the
// active/experiential places, so a day built around one isn't flagged as "flat".
export const isSoftFun = (a: Attraction) =>
  a.category === "nature" || a.subcategory === "park" || a.subcategory === "garden" ||
  (a.must_see === 1 && a.category === "attraction");

// Dwell time — how long you actually SPEND at a place. OSM duration_minutes is
// unreliable (a bridge tagged 60m), so we classify by what the place IS:
//   passby   — you walk over/past and look (bridge, viewpoint, monument, square,
//              gate, statue, hill, street, meridian line) → minutes, not an hour.
//   standard — a real but not all-day stop (church, garden, general sight).
//   deep     — a ticketed interior you tour (museum, gallery, castle/palace, zoo).
//   market   — a market/shopping street you graze for an afternoon.
// The MINUTES per bucket are a technique (visit_minutes); the buckets are engine.
const MARKET_RX = /\bmarket\b|שוק|bazaar|בזא?ר|מרקט/i;
// "activity" = a half-day adventure/experience you don't rush: theme/water/rope/
// adventure parks, karting, climbing, big model-worlds, immersive experiences.
const ACTIVITY_RX = /theme_park|amusement|לונה.?פארק|funfair|water_?park|פארק מים|aquapark|high.?rope|ropes? course|park חבלים|פארק חבלים|adventure|הרפתק|zip.?line|אומגה|קארט|go.?kart|gokart|climb(ing)?|טיפוס|escape.?room|חדר בריחה|trampoline|טרמפולין|traumwerk|טראומוורק|little.?big|ליטל ביג|miniatur|experience|חוויי?ה|alpine.?coaster|toboggan|מזחל|\bluge\b|\bbob(sled)?\b/i;
const DEEP_RX = /\bmuseum\b|מוזיאון|gallery|galleries|גלריה|castle|טירה|מצודה|palace|ארמון|fortress|מבצר|\bzoo\b|גן ?חיות|aquarium|אקווריום|dungeon|planetarium|פלנטריום|\bhangar\b|האנגר|exhibition|תערוכה/i;
const PASSBY_RX = /bridge|גשר|viewpoint|view from|תצפית|observation|lookout|מצפור|monument|אנדרט|memorial|statue|פסל|\bsquare\b|כיכר|piazza|plaza|\bgate\b|שער |fountain|מזרק|\bhill\b|גבעה|\bstreet\b|רחוב|promenade|טיילת|\bpier\b|מזח|meridian|מרידיאן|קו האורך|column|עמוד|obelisk|אובליסק/i;

export type DwellBucket = "passby" | "standard" | "deep" | "activity" | "market";
export type DwellCfg = Record<DwellBucket, number>;
export const DWELL_DEFAULT: DwellCfg = { passby: 20, standard: 50, deep: 110, activity: 180, market: 150 };

export function dwellBucket(a: Attraction): DwellBucket {
  const t = blob(a);
  if (a.category === "shopping" || MARKET_RX.test(t)) return "market";
  if (ACTIVITY_RX.test(t)) return "activity";
  if (a.category === "museum" || a.subcategory === "castle" || DEEP_RX.test(t)) return "deep";
  if ((a.category === "historic" && /memorial|monument|ruins/.test(a.subcategory ?? "")) || PASSBY_RX.test(t)) return "passby";
  return "standard";
}
export const dwellMinutes = (a: Attraction, cfg: DwellCfg = DWELL_DEFAULT): number => cfg[dwellBucket(a)];

// Dark/heavy history (Nazism, Holocaust) — not a clean OSM category (usually tagged
// "museum"/"historic"), so it needs a keyword trait. Lets a rule avoid it on family
// trips without dropping good museums.
const HEAVY_HISTORY_RX = /היטלר|נאצי|\bnazi\b|holocaust|שואה|גסטפו|dokumentation.?obersalzberg|אוברזלצברג|מחנה ריכוז|concentration camp|kz\b|memorial/i;
export const isHeavyHistory = (a: Attraction) => HEAVY_HISTORY_RX.test(blob(a));

// Single matcher used by rule kinds (avoid_category, max_type_per_day). Handles the
// keyword pseudo-types ('heavy_history', 'active') and plain category / experience-type.
export function stopMatchesType(a: Attraction, t: string): boolean {
  if (t === "heavy_history") return isHeavyHistory(a);
  if (t === "active") return isActiveAnchor(a);
  return a.category === t || a.audience_fit?.type === t;
}

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

// Time-of-day fit from the place's own advice (best_time_he / tips). A place tagged
// ONLY morning (sunrise view, "הגיעו מוקדם", morning market) wants the start of the
// day; ONLY evening/night (bars, sunset point, night market) wants the end. Anything
// good at BOTH or neither is FLEXIBLE ("any") — a square that's shops by day and bars
// by night imposes no order, geography decides.
// Only GENUINELY time-exclusive signals — a generic "arrive early to beat the queues"
// tip (on nearly every popular sight) is NOT morning-exclusivity, so it's excluded.
const MORNING_RX = /זריחה|עלות השחר|טרם עלות השחר|שוק בוקר|מוקדם בבוקר|sunrise|\bdawn\b|early morning|morning market/i;
// Bare "ערב" is avoided (it also matches מערב=west); require an evening word form.
const EVENING_RX = /שקיעה|בערב|לערב|בשעות הערב|שעות הערב|בין הערביים|בלילה|חיי לילה|מועדון|ברים|פאב|נייטלייף|שוק לילה|sunset|\bevening\b|\bnight\b|nightlife|night market/i;
export type TimeBucket = "morning" | "any" | "evening";
export function bestTimeBucket(a: { best_time_he?: string | null; tips_he?: string | null; time_of_day?: string | null }): TimeBucket {
  if (a.time_of_day === "morning" || a.time_of_day === "evening" || a.time_of_day === "any") return a.time_of_day;  // editor override
  const t = `${a.best_time_he ?? ""} ${a.tips_he ?? ""}`.toLowerCase();
  const m = MORNING_RX.test(t), e = EVENING_RX.test(t);
  if (m && !e) return "morning";
  if (e && !m) return "evening";
  return "any";  // both, or (usually) neither → flexible, geography decides
}
const timeRank = (a: Attraction) => { const b = bestTimeBucket(a); return b === "morning" ? 0 : b === "evening" ? 2 : 1; };
// Stable reorder within a day: morning-only stops to the front, evening-only to the
// back, geography order preserved for everything in between (and within each bucket).
export function reorderByTimeOfDay(day: Attraction[]): Attraction[] {
  return day.map((a, i) => ({ a, i })).sort((x, y) => timeRank(x.a) - timeRank(y.a) || x.i - y.i).map((z) => z.a);
}

// Orient a proximity-ordered day so morning-leaning stops fall earlier and
// evening / day-ender stops later — by choosing the better of the path's TWO
// directions (forward vs reversed). Reversing preserves EVERY adjacency, so the
// walking route is never torn (unlike a per-stop reshuffle, which used to send a
// sunset museum across the river to the day's end, away from its neighbour). A
// time-exclusive stop stuck mid-route stays put — proximity wins over a soft
// preference. `includeEnders` folds day-enders into the "late" signal.
export function orientDay(day: Attraction[], includeEnders = true): Attraction[] {
  if (day.length < 3) return day;
  const phase = (a: Attraction) =>
    (includeEnders && isDayEnder(a)) ? 2 : timeRank(a);
  const inversions = (seq: Attraction[]) => {
    let v = 0;
    for (let i = 0; i < seq.length; i++)
      for (let j = i + 1; j < seq.length; j++)
        if (phase(seq[i]) > phase(seq[j])) v++;
    return v;
  };
  const rev = [...day].reverse();
  return inversions(rev) < inversions(day) ? rev : day;
}
