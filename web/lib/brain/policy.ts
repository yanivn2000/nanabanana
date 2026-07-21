// The Brain — policy (the calibratable "state"). See docs/logic/brain.md.
//
// This file is DATA, not algorithm: weights, thresholds and per-audience Israeli
// travel preferences. The critic scores trips using these; the builder optimises
// toward the critic. When the editor gives feedback, a Claude Code session TUNES
// THIS FILE (not the code) — that is how the Brain "learns". Bump VERSION each
// calibration so we can track and regression-test changes.
//
// The Brain never calls a paid AI. Its intelligence lives here + in critique.ts.

export const BRAIN_VERSION = "1.2.0";

export type Audience = "families" | "couples" | "friends";

// How many meaningful stops/day feel right per audience (Israeli pace: not too
// packed, room for food + spontaneity). v1.2: families bumped 4→5 — an editor note
// found 3 hour-long stops "a boring day for a family with kids"; families want a
// fuller day WITH at least one active anchor + small pop-in gems (see traits.ts).
export const PACE_STOPS: Record<Audience, number> = { families: 5, couples: 5, friends: 5 };

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
export const AUDIENCE_PREFS: Record<Audience, { boost: string[]; avoid: string[]; kidFriendly: boolean }> = {
  families: { boost: ["nature", "attraction", "museum", "leisure"], avoid: ["nightlife", "bar"], kidFriendly: true },
  couples:  { boost: ["romantic", "food", "culture", "historic", "viewpoint"], avoid: [], kidFriendly: false },
  friends:  { boost: ["nightlife", "food", "market", "shopping", "viewpoint"], avoid: [], kidFriendly: false },
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
