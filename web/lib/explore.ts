import type { Attraction } from "./db";
import type { FamilyProfile } from "./store";

// ---------------------------------------------------------------------------
// Explore flow ("חקירת יעד") — logic for the 4-step destination-exploration
// funnel. Step 2 macro content + category aggregation, step 3 chips, and the
// per-trip taste calibration. Pure functions; the UI lives in ExploreFlow.tsx.
// ---------------------------------------------------------------------------

// --- Step 2a: macro brief. Hand-written now (London pilot); AI-generated per
// destination later, then reliable-source facts (fast-follow F2). ------------
export type CityBrief = { narrative_he: string; history_he: string; language_he: string };

export const CITY_BRIEF: Record<string, CityBrief> = {
  London: {
    narrative_he:
      "עיר-עולם ענקית על גדות התמזה — נהר שחוצה שכונות עם אופי משלהן, מוזיאונים " +
      "עצומים (רבים מהם חינם), פארקים ירוקים, ותרבות שאין לה סוף: מוזיקה, תיאטרון, " +
      "שווקים ואוכל מכל העולם.",
    history_he:
      "כמעט 2000 שנה של היסטוריה — מרומא, דרך מגדל לונדון בן האלף, ועד עיר עולמית מודרנית.",
    language_he: "אנגלית",
  },
};

export function briefFor(city: string): CityBrief {
  return (
    CITY_BRIEF[city] ?? {
      narrative_he: "יעד עשיר עם הרבה לגלות — שכונות, אוכל, תרבות ואתרים.",
      history_he: "",
      language_he: "",
    }
  );
}

// --- Step 2a: seasonal weather text (averages). Live API later (F2). --------
const WEATHER: { he: string; hint_he: string }[] = [
  { he: "8°/3°, לרוב גשום", hint_he: "חורף — מעיל חם וטריות" },       // Jan
  { he: "8°/3°, קר וגשום", hint_he: "חורף — שכבות ומעיל" },           // Feb
  { he: "11°/4°, מתחמם לאט", hint_he: "אביב מוקדם — ז'קט ומטריה" },    // Mar
  { he: "14°/6°, גשמי אביב", hint_he: "אביב — ז'קט קליל ומטריה" },     // Apr
  { he: "17°/9°, נעים", hint_he: "אביב — נעים, קחו שכבה" },            // May
  { he: "20°/12°, נעים ומאיר", hint_he: "קיץ — לבוש קליל, אולי טפטוף" }, // Jun
  { he: "23°/14°, חמים ונעים", hint_he: "קיץ — לבוש קליל" },           // Jul
  { he: "23°/14°, חמים ונעים", hint_he: "קיץ — לבוש קליל" },           // Aug
  { he: "20°/11°, נעים", hint_he: "סתיו מוקדם — שכבה קלה" },           // Sep
  { he: "15°/8°, סתווי", hint_he: "סתיו — ז'קט ומטריה" },              // Oct
  { he: "11°/5°, קר וגשום", hint_he: "סתיו מאוחר — מעיל" },            // Nov
  { he: "8°/3°, קר וחגיגי", hint_he: "חורף — מעיל חם; עונת חג המולד" }, // Dec
];

export function seasonalWeather(month: number): { he: string; hint_he: string } {
  return WEATHER[((month - 1) % 12 + 12) % 12] ?? WEATHER[0];
}

// --- Step 2b: category vocabulary (the "types" the user like/dislikes). ------
// `icon` is a lucide component name resolved in ExploreFlow.
export type ExploreCat = { tag: string; label_he: string; icon: string };
export const EXPLORE_CATS: ExploreCat[] = [
  { tag: "live_music", label_he: "מוזיקה חיה", icon: "Music" },
  { tag: "vintage_shopping", label_he: "שווקי וינטג'", icon: "Shirt" },
  { tag: "nightlife", label_he: "חיי לילה", icon: "Wine" },
  { tag: "theatre", label_he: "מחזמר ותיאטרון", icon: "Ticket" },
  { tag: "classical_opera", label_he: "בלט ואופרה", icon: "Drama" },
  { tag: "art", label_he: "אמנות ומוזיאונים", icon: "Image" },
  { tag: "history", label_he: "היסטוריה ומורשת", icon: "Landmark" },
  { tag: "nature", label_he: "טבע ופארקים", icon: "Trees" },
  { tag: "food", label_he: "אוכל ושווקים", icon: "UtensilsCrossed" },
  { tag: "luxury_shopping", label_he: "קניות יוקרה", icon: "Gem" },
  { tag: "sports", label_he: "ספורט", icon: "Trophy" },
  { tag: "family", label_he: "לילדים", icon: "Baby" },
  { tag: "landmark", label_he: "אתרי חובה", icon: "Star" },
];

const TAG_LABEL: Record<string, string> = {
  live_music: "מוזיקה חיה", nightlife: "חיי לילה", vintage_shopping: "וינטג'",
  luxury_shopping: "יוקרה", theatre: "תיאטרון", classical_opera: "בלט ואופרה",
  sports: "ספורט", food: "אוכל", art: "אמנות", history: "היסטוריה",
  nature: "טבע", family: "משפחתי", culture: "תרבות", landmark: "אתר חובה",
};

// How "alive" a category is in this city, from the real count of tagged
// attractions. Positive framing only — never a negative label (decision 4).
function vibe(count: number): string {
  if (count >= 30) return "שוקק";
  if (count >= 12) return "מלא";
  if (count >= 4) return "יש כמה";
  return "מעט";
}

export type CatCard = {
  tag: string; label_he: string; icon: string;
  count: number; vibe_he: string; hot: boolean;
};

// Categories that only make sense for a given traveler composition (step 1).
// Keyed by tag → predicate over the profile. A tag NOT listed here is always
// relevant. This is the single, extensible home for composition rules — the
// decision is derived from live step-1 state, never from a hardcoded exclude
// list, so editing "who's travelling" re-filters step 2 immediately.
const CAT_RELEVANCE: Record<string, (p: FamilyProfile) => boolean> = {
  family: (p) => p.kids.length > 0, // "לילדים" only surfaces when kids are aboard
};

export function relevantForProfile(tag: string, p: FamilyProfile): boolean {
  const pred = CAT_RELEVANCE[tag];
  return pred ? pred(p) : true;
}

// Aggregate the destination's attractions by taste tag → 5–15 category cards,
// ordered by how relevant they are to the profile (taste weight) then by how
// alive they are here. `hot` marks a standout the profile didn't ask for — the
// gentle "must-see" nudge (decision 3), shown as a "בולט" chip. Categories that
// don't fit the traveler composition (e.g. "לילדים" with no kids) are dropped.
export function categoriesFor(
  attractions: Attraction[],
  taste: Record<string, number>,
  profile: FamilyProfile,
  max = 12
): CatCard[] {
  const counts: Record<string, number> = {};
  for (const a of attractions) {
    for (const t of a.taste_tags ?? []) counts[t] = (counts[t] ?? 0) + 1;
  }
  const cards = EXPLORE_CATS
    .filter((c) => (counts[c.tag] ?? 0) > 0 && relevantForProfile(c.tag, profile))
    .map((c) => {
    const count = counts[c.tag] ?? 0;
    return {
      tag: c.tag, label_he: c.label_he, icon: c.icon, count,
      vibe_he: vibe(count),
      hot: count >= 25 && (taste[c.tag] ?? 0) < 3, // big here, but not top-of-mind for them
    };
  });
  cards.sort((x, y) => (taste[y.tag] ?? 0) - (taste[x.tag] ?? 0) || y.count - x.count);
  return cards.slice(0, Math.max(5, Math.min(max, cards.length)));
}

// Layer the step-2 like/dislike onto the profile-derived taste → the per-trip
// calibrated model that ranks step 3 (decision 5: per-THIS-trip). --------------
export function calibrate(
  base: Record<string, number>,
  likes: Set<string>,
  dislikes: Set<string>
): Record<string, number> {
  const w = { ...base };
  for (const t of likes) w[t] = (w[t] ?? 0) + 2;
  for (const t of dislikes) w[t] = (w[t] ?? 0) - 3;
  return w;
}

// --- Step 3: display chips for one attraction. -------------------------------
export type Chip = { label_he: string; kind: "must" | "taste" | "price" | "nudge" };

export function attractionChips(a: Attraction, taste: Record<string, number>): Chip[] {
  const chips: Chip[] = [];
  if (a.must_see === 1) chips.push({ label_he: "חובה", kind: "must" });
  for (const t of (a.taste_tags ?? []).slice(0, 3)) {
    if (TAG_LABEL[t]) chips.push({ label_he: TAG_LABEL[t], kind: "taste" });
  }
  if (a.cost_level != null) {
    chips.push(
      a.cost_level <= 0
        ? { label_he: "חינם", kind: "price" }
        : { label_he: "$".repeat(Math.min(3, a.cost_level)), kind: "price" }
    );
  }
  // Iconic (must-see) but not something they strongly asked for → the gentle
  // "דחיפה" discovery push (decision 3). Uses the "not top-of-mind" (< 3)
  // threshold like the step-2 `hot` badge — NOT `tasteScore <= 0`, because the
  // structural +1 baseline (landmark/art/history) means every iconic site would
  // otherwise never qualify. So a West End musical for a non-theatre couple, or
  // the Tower of London for a nightlife couple, correctly gets the push.
  const topWeight = Math.max(0, ...(a.taste_tags ?? []).map((t) => taste[t] ?? 0));
  if (a.must_see === 1 && topWeight < 3) {
    chips.push({ label_he: "דחיפה", kind: "nudge" });
  }
  return chips;
}

// --- Step 3: expandable detail — enough to decide כן/אולי/לא, no API cost. ----
// The personalization hook: which of the tags THIS trip weights positively does
// the attraction match? Positive framing, ≤2 labels. Falls back to the must-see
// nudge so iconic spots still get a reason. Null → no line (keeps it honest).
export function whyItFits(a: Attraction, taste: Record<string, number>): string | null {
  // Exclude "landmark" — it's a structural must-see marker (already a chip),
  // not a taste the user "likes"; "אוהבים אתר חובה" reads wrong.
  const liked = [...new Set((a.taste_tags ?? [])
    .filter((t) => t !== "landmark" && (taste[t] ?? 0) >= 3 && TAG_LABEL[t]))];
  liked.sort((x, y) => (taste[y] ?? 0) - (taste[x] ?? 0));
  const labels = liked.slice(0, 2).map((t) => TAG_LABEL[t]);
  if (labels.length) return `מתאים לכם כי אתם אוהבים ${labels.join(" ו")}`;
  if (a.must_see === 1) return "מאיקוני העיר — שווה הצצה גם אם זה לא בראש שלכם";
  return null;
}

function durationHe(min: number): string {
  if (min < 60) return `כ-${min} דק'`;
  const whole = Math.floor(min / 60);
  const rem = min % 60;
  const hrs = whole === 1 ? "שעה" : `${whole} שעות`;
  if (rem === 0) return whole === 1 ? "כשעה" : `כ-${whole} שעות`;
  if (rem === 30) return whole === 1 ? "כשעה וחצי" : `כ-${hrs} וחצי`;
  return `כ-${hrs} ו-${rem} דק'`;
}

function indoorHe(io: string): string {
  const v = io.toLowerCase();
  if (v.includes("both") || v.includes("mixed")) return "מקורה ופתוח";
  const inside = v.includes("indoor") || v.includes("מקור");
  const outside = v.includes("outdoor") || v.includes("open") || v.includes("פתוח");
  if (inside && outside) return "מקורה ופתוח";
  if (inside) return "מקום מקורה";
  if (outside) return "בחוץ (פתוח)";
  return io;
}

// Practical facts that can make or break the decision (time budget, timing,
// weather fit, dress). Cost stays a chip in the compact card, so it's omitted.
export function attractionFacts(a: Attraction): { label_he: string; value_he: string }[] {
  const f: { label_he: string; value_he: string }[] = [];
  if (a.duration_minutes) f.push({ label_he: "משך", value_he: durationHe(a.duration_minutes) });
  if (a.best_time_he) f.push({ label_he: "מתי", value_he: a.best_time_he });
  if (a.indoor_outdoor) f.push({ label_he: "היכן", value_he: indoorHe(a.indoor_outdoor) });
  if (a.dress_he) f.push({ label_he: "לבוש", value_he: a.dress_he });
  return f;
}

// Verified-traveller insight kinds → Hebrew labels (matches the admin taxonomy).
export const INSIGHT_KIND_HE: Record<string, string> = {
  tip: "טיפ ממטיילים", warning: "לתשומת לב", verdict: "שורה תחתונה",
  food: "אוכל", season: "עונה", access: "נגישות",
};
