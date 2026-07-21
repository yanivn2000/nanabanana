// The Brain — policy (the calibratable "state"). See docs/logic/brain.md.
//
// This file is DATA, not algorithm: weights, thresholds and per-audience Israeli
// travel preferences. The critic scores trips using these; the builder optimises
// toward the critic. When the editor gives feedback, a Claude Code session TUNES
// THIS FILE (not the code) — that is how the Brain "learns". Bump VERSION each
// calibration so we can track and regression-test changes.
//
// The Brain never calls a paid AI. Its intelligence lives here + in critique.ts.

// Version log (bump on every substantive calibration/engine change):
//   1.1 — variety by experience-type; 1.2 — family pace + active anchor;
//   1.3 — audience axis = with-kids / without-kids;
//   1.4 — engine generation: trait-based dwell (visit_minutes), fill-all-days
//         equal-TIME day slices, texture-aware pool ranking, cross-day dedup,
//         data-driven fun-anchor (active-anchor moved out of conformance).
export const BRAIN_VERSION = "1.4.0";

// v1.3 (editor): the real axis is WITH KIDS vs WITHOUT, not families/couples/friends
// — couple-vs-friends is a soft taste sub-signal, not a hard audience. "families" =
// with kids; "adults" = without kids (suits a couple OR a group of friends).
export type Audience = "families" | "adults";

// The raw AI judgment lives in audience_fit {families,couples,friends}; map it to the
// two traveler types. "adults" = good for a couple OR for friends → the max.
export function audienceFitScore(
  af: { families?: number; couples?: number; friends?: number } | null | undefined, aud: Audience
): number {
  if (!af) return 0;
  return aud === "families" ? (af.families ?? 0) : Math.max(af.couples ?? 0, af.friends ?? 0);
}

// Candidate value for ranking the pool. must-see is a strong boost but NOT an
// absolute gate — a genuinely loved market / food street / neighbourhood can outrank
// a minor must-see, which is how a day earns TEXTURE (not five landmarks in a row).
// Texture categories get a small lift toward that.
export function poolValue(
  a: { must_see?: number | null; audience_fit?: { families?: number; couples?: number; friends?: number } | null; category?: string | null; subcategory?: string | null },
  aud: Audience
): number {
  const fit = audienceFitScore(a.audience_fit, aud);
  const must = a.must_see === 1 ? 80 : 0;
  const cat = a.category ?? "", sub = a.subcategory ?? "";
  // Only FOOD / MARKET / NEIGHBOURHOOD get a lift — the "texture" the trip lacked.
  // Parks are NOT boosted (a city has plenty and many are already must-see, so a
  // boost floods whole days with scattered parks).
  const texture = cat === "food" || cat === "shopping" || /market|שוק|neighbou?rhood|quarter|שכונה|רובע/i.test(sub) ? 25 : 0;
  return must + fit + texture;
}

// How many meaningful stops/day feel right per audience (Israeli pace: not too
// packed, room for food + spontaneity). v1.2: families bumped 4→5 — an editor note
// found 3 hour-long stops "a boring day for a family with kids"; families want a
// fuller day WITH at least one active anchor + small pop-in gems (see traits.ts).
export const PACE_STOPS: Record<Audience, number> = { families: 5, adults: 5 };

// Walking between a day's stops (minutes) — comfort band before we flag it.
export const DAY_WALK = { ideal: 45, flag: 95 };

// Critic dimension weights (sum ≈ 1). Tuned from editor feedback over time.
export const WEIGHTS: Record<string, number> = {
  walkability: 0.16,   // tight, walkable days
  mustSee:     0.20,   // covers the city's real must-sees for this audience
  audienceFit: 0.18,   // stops actually suit families / couples / friends
  variety:     0.14,   // not 5 museums in a row
  pace:        0.12,   // right number of stops/day
  balance:     0.10,   // days are balanced, none empty/overloaded
  coherence:   0.10,   // each day is one geographic area
};

// Israeli travel culture per audience — category leanings that make a trip "feel
// right" to this segment. Categories match the OSM-derived attraction.category
// and the audience_fit.type vocabulary. Editor calibrates these.
// v1.3: with-kids is driven mainly by a NEGATIVE filter — a young child just follows
// the parents, so the signal is "not suitable for kids" (heavy history, bars,
// nightlife) more than "designed for kids". Adults merge the old couples+friends.
export const AUDIENCE_PREFS: Record<Audience, { boost: string[]; avoid: string[]; kidFriendly: boolean }> = {
  families: { boost: ["nature", "attraction", "museum", "leisure"], avoid: ["nightlife", "bar", "heavy_history"], kidFriendly: true },
  adults:   { boost: ["romantic", "food", "culture", "historic", "viewpoint", "nightlife", "market", "shopping"], avoid: [], kidFriendly: false },
};

// A trip needs work if its overall score is below this, or if any CRITICAL issue
// fires (see critique.ts). 0–100 scale.
export const QUALITY_BAR = 70;

// Thresholds the critic uses to raise specific issues.
export const THRESHOLDS = {
  minMustSeePerTrip: 3,        // a real trip should hit at least this many must-sees
  maxSameTypeRun: 3,          // consecutive same experience-TYPE stops in a day = monotony (v1.1: by audience_fit.type, not raw OSM category)
  minAudienceFit: 45,          // per-stop audience_fit below this = poor fit
  balanceTimeStdMax: 110,      // v1.1: std-dev of per-day TIME (visit+walk, minutes) above this = imbalance; count-based was over-penalising a tight 6-stop day vs a spread 4-stop day of equal duration
  minFamilyStopsForAnchor: 3, // v1.2: a family day with ≥ this many stops must have at least one ACTIVE anchor (cable-car/toboggan/gorge/pool…) — all-passive-culture days bore kids
};
