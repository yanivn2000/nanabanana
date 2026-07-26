import type { FamilyProfile } from "./store";
import type { Attraction } from "./db";

// Maps a profile interest chip → the attraction taste_tags it implies. This is
// the bridge from the (coarse) profile to the taste vocabulary the attractions
// are tagged with. #63
export const INTEREST_TASTE: Record<string, string[]> = {
  "טבע": ["nature"],
  // "אוכל" is the merged food+shopping governing chip → spans both taste families.
  "אוכל": ["food", "vintage_shopping", "luxury_shopping"],
  "תרבות": ["art", "theatre", "classical_opera", "culture"],
  "קניות": ["vintage_shopping", "luxury_shopping"],
  "ספורט": ["sports"],
  // Beaches have no dedicated taste tag; matched only via the `beach`
  // subcategory below. Mapping to "nature" made every park a "beach" (London
  // showed 16 "beaches") — kept empty so it stays distinct from טבע.
  "חופים": [],
  // Amusement parks = the theme_park/water_park subcategory only (INTEREST_CATS)
  // — NOT the broad "family" tag, which made regular parks/zoos look like
  // amusement parks and identical to "ילדים".
  "פארקי שעשועים": [],
  // Kids = the whole family-friendly set: the curated "family" tag PLUS the
  // kid subcategories. Broader than amusement parks by design.
  "ילדים": ["family"],
  // History = the topical "history" tag (+ the historic category below) ONLY.
  // "landmark" is a structural iconic-sight tag carried by nearly every
  // must-see (museums, markets, viewpoints) — including it meant ✕ היסטוריה
  // dimmed/hid the entire must-see set of a city.
  "היסטוריה": ["history"],
  // finer taste chips (added to the editor for real divergence):
  "מוזיקה": ["live_music"],
  "חיי לילה": ["nightlife"],
  "מחזמר ותיאטרון": ["theatre"],
  "בלט ואופרה": ["classical_opera"],
  "וינטג'": ["vintage_shopping"],
  "יוקרה": ["luxury_shopping"],
  "מוזיאונים": ["art"],
};

// Derive a weighted taste model {tag: weight} from a family profile. Likes add,
// dislikes subtract; a small structural baseline keeps a trip from being empty.
// An explicit p.taste (from a future equalizer) overrides.
export function deriveTaste(p: FamilyProfile): Record<string, number> {
  const w: Record<string, number> = {};
  const bump = (tags: string[], by: number) => {
    for (const t of tags) w[t] = (w[t] ?? 0) + by;
  };
  for (const it of p.interests) bump(INTEREST_TASTE[it] ?? [], 3);
  for (const it of p.dislikes) bump(INTEREST_TASTE[it] ?? [], -3);
  // Kids aboard → family-tagged attractions matter, even if no one thought to
  // pick a "kids" interest chip (they rarely do — the kids ARE the context).
  if (p.kids.length > 0) bump(["family"], 3);
  for (const t of ["landmark", "art", "history", "nature"]) w[t] = (w[t] ?? 0) + 1;
  return { ...w, ...(p.taste ?? {}) };
}

export function tasteScore(tags: string[] | null, w: Record<string, number>): number {
  if (!tags || !tags.length) return 0;
  return tags.reduce((s, t) => s + (w[t] ?? 0), 0);
}

// Coarse profile match for cities that aren't taste-tagged yet: map profile
// interest chips onto attraction categories/subcategories. Weaker than
// taste_tags, but it lets "מתאים לי" work in every city. (#63)
export const INTEREST_CATS: Record<string, { cats?: string[]; subs?: string[] }> = {
  "טבע": { cats: ["nature"] },
  "חופים": { subs: ["beach"] },
  // food & markets: eateries AND market halls/stalls (markets are often tagged as a
  // marketplace subcategory rather than the food category).
  "אוכל": { cats: ["food", "shopping"], subs: ["market", "marketplace", "deli", "farm"] },
  "תרבות": { cats: ["museum", "historic"] },
  "מוזיאונים": { cats: ["museum"] },
  "קניות": { cats: ["shopping"], subs: ["market", "marketplace"] },
  // architecture & streets: iconic historic buildings + viewpoints (the streets half
  // arrives with the Layer-2 area→street auto-include; here it leans historic).
  "אדריכלות": { cats: ["historic"], subs: ["viewpoint", "attraction"] },
  // וינטג' / יוקרה are FLAVORS of shopping, not all of it — mapping them to the
  // whole shopping category made their tiles clone קניות. Match by the shop-kind
  // subcategory (mirrors pipeline_food.py's VINTAGE_SHOPS / LUXURY_SHOPS) — the
  // vintage_shopping / luxury_shopping taste tags still match on top.
  "וינטג'": { subs: ["antiques", "second_hand", "charity", "books", "vintage", "market", "marketplace"] },
  "יוקרה": { subs: ["jewelry", "watches", "perfumery", "department_store", "boutique", "bag", "fashion_accessories"] },
  "ספורט": { cats: ["sport"] },
  "היסטוריה": { cats: ["historic"] },
  // Nightlife venues are ingested as food/<sub> — match the going-out subcategories
  // so the "חיי לילה" chip actually finds bars/clubs/live-music (they rank too low to
  // reach the base pool on their own; route.ts force-includes the top matches).
  "חיי לילה": { subs: ["bar", "pub", "nightclub", "cocktail", "wine_bar", "biergarten", "brewery", "jazz_club", "music_venue", "lounge", "nightlife", "disco"] },
  "פארקי שעשועים": { subs: ["theme_park", "water_park"] },
  // Genuinely kid-oriented places only (not big adult museums that merely have a
  // high family_score) — so ✕ "ילדים" hides these while museums still show.
  "ילדים": { subs: ["theme_park", "water_park", "zoo", "aquarium", "playground"] },
};
export function coarseFits(
  category: string,
  subcategory: string | null,
  interests: string[]
): boolean {
  for (const it of interests) {
    const m = INTEREST_CATS[it];
    if (!m) continue;
    if (m.cats?.includes(category)) return true;
    if (subcategory && m.subs?.includes(subcategory)) return true;
  }
  return false;
}

// Family-fit for kid trips: the editor's kids rating overrides the data score —
// "yes" forces a strong weight (a curated kid pick always ranks up), "no" zeroes
// it (kept out of the family ordering even if family_score is high), else use
// family_score. Shared with the heuristic builder so both agree.
export function familyFit(a: Attraction): number {
  if (a.editor_kids === "yes") return Math.max(a.family_score ?? 0, 9);
  if (a.editor_kids === "no") return 0;
  return a.family_score ?? 0;
}

// Re-rank attractions so INTERESTS govern the pick, with must-see a permanent
// (moderate) lean and — ONLY for trips with kids — family fit. Weights are tuned so
// a single matching taste-tag (weight 3 → ×3 = 9) still outranks a bare must-see
// (MUST_SEE_LEAN 6): interests lead the FILL, while the city-defining icons get a
// guaranteed floor via the reservation in the build route (not a big weight here).
// `interests` (the chip keys) enable a coarse category fallback for the ~half of a
// city's places that aren't taste-tagged yet. Returns the top `n`; falls back to
// source order only when there's neither taste nor interests.
const MUST_SEE_LEAN = 6;   // was 2 — a lean, not a dominator
const INTEREST_MULT = 3;
const COARSE_CREDIT = 2;   // pre-mult credit for an untagged place that matches a chosen interest by category
export type Audience = "families" | "adults";
// Audience appropriateness (0-100) — the stronger of couples/friends for adults.
export function audienceFit(a: Attraction, aud: Audience): number {
  return aud === "families" ? (a.audience_fit?.families ?? 0)
    : Math.max(a.audience_fit?.couples ?? 0, a.audience_fit?.friends ?? 0);
}
export function rankByTaste(
  attractions: Attraction[],
  taste: Record<string, number> | undefined,
  n: number,
  isFamily = false,
  interests?: string[],
  audience?: Audience
): Attraction[] {
  const hasTaste = taste && Object.keys(taste).length > 0;
  if (!hasTaste && !interests?.length && !audience) return attractions.slice(0, n);
  const w = taste ?? {};
  const scored = attractions.map((a) => {
    let raw = tasteScore(a.taste_tags, w);
    if (raw === 0 && interests?.length && coarseFits(a.category, a.subcategory, interests)) raw = COARSE_CREDIT;
    return {
      a,
      s: raw * INTEREST_MULT
        + (isFamily ? familyFit(a) : 0)
        + (audience ? audienceFit(a, audience) / 25 : 0)   // 0-4: who ranks appeal, interests govern the mix
        + (a.must_see === 1 ? MUST_SEE_LEAN : 0),
    };
  });
  scored.sort((x, y) => y.s - x.s);
  return scored.map((x) => x.a).slice(0, n);
}

// The single governing interest set (owner-approved 7 chips). Each chip's `key` is
// a canonical interest that INTEREST_TASTE + INTEREST_CATS understand, so the same
// key both weights taste (via deriveTaste) and drives the coarse fallback + the
// build-route theme reservation. This is the ONE interest input shown to travellers.
export const GOVERNING_INTERESTS: { key: string; label: string; emoji: string }[] = [
  { key: "מוזיאונים", label: "מוזיאונים ואמנות", emoji: "🖼️" },
  // Food & shopping were bit-for-bit identical builds (both only surfaced the 2
  // markets) — merged into one governing chip. The "אוכל" key now spans food +
  // shopping in the maps below.
  { key: "אוכל", label: "אוכל, שווקים וקניות", emoji: "🍽️" },
  { key: "טבע", label: "טבע ופארקים", emoji: "🌳" },
  { key: "חיי לילה", label: "חיי לילה", emoji: "🍸" },
  { key: "היסטוריה", label: "היסטוריה ותרבות", emoji: "🏛️" },
  { key: "אדריכלות", label: "אדריכלות ורחובות", emoji: "🏙️" },
];

// Name-keyword fallback for the theme reservation, for interests whose places are
// often mis-tagged/mis-categorised in OSM (markets frequently land as a generic
// "attraction" with no food/shopping tag). name_he is normalised Hebrew across all
// cities (we name every market "שוק …"), so "שוק" reliably catches them everywhere.
export const INTEREST_KEYWORDS: Record<string, string[]> = {
  "אוכל": ["שוק", "קניון", "פסאז'"],
  "קניות": ["שוק", "קניון", "פסאז'"],
};

// A per-interest taste-weight map (chip key → {tag: 1}) for scoring a single theme
// during the build-route reservation. Empty for chips with no dedicated tag
// (architecture) — those rely on the coarse category fallback.
export function interestTasteMap(key: string): Record<string, number> {
  return Object.fromEntries((INTEREST_TASTE[key] ?? []).map((t) => [t, 1]));
}

// Top-weighted taste tags → a short Hebrew emphasis line for the AI prompt.
const TAG_HE: Record<string, string> = {
  live_music: "מוזיקה", nightlife: "חיי לילה", vintage_shopping: "שווקי וינטג'",
  luxury_shopping: "קניות יוקרה", theatre: "תיאטרון ומחזות", classical_opera: "בלט ואופרה",
  sports: "ספורט", food: "אוכל", art: "אמנות ומוזיאונים", history: "היסטוריה",
  nature: "טבע ופארקים", family: "פעילויות משפחתיות", culture: "תרבות",
};
export function tasteEmphasis(taste: Record<string, number> | undefined): string {
  if (!taste) return "";
  const top = Object.entries(taste)
    .filter(([, w]) => w >= 4)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => TAG_HE[t] ?? t)
    .slice(0, 5);
  return top.length ? top.join(", ") : "";
}
