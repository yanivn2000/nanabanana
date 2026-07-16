import type { FamilyProfile } from "./store";
import type { Attraction } from "./db";

// Maps a profile interest chip → the attraction taste_tags it implies. This is
// the bridge from the (coarse) profile to the taste vocabulary the attractions
// are tagged with. #63
export const INTEREST_TASTE: Record<string, string[]> = {
  "טבע": ["nature"],
  "אוכל": ["food"],
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
  "אוכל": { cats: ["food"] },
  "תרבות": { cats: ["museum", "historic"] },
  "מוזיאונים": { cats: ["museum"] },
  "קניות": { cats: ["shopping"] },
  // וינטג' / יוקרה are FLAVORS of shopping, not all of it — mapping them to the
  // whole shopping category made their tiles clone קניות. Match by the shop-kind
  // subcategory (mirrors pipeline_food.py's VINTAGE_SHOPS / LUXURY_SHOPS) — the
  // vintage_shopping / luxury_shopping taste tags still match on top.
  "וינטג'": { subs: ["antiques", "second_hand", "charity", "books", "vintage", "market", "marketplace"] },
  "יוקרה": { subs: ["jewelry", "watches", "perfumery", "department_store", "boutique", "bag", "fashion_accessories"] },
  "ספורט": { cats: ["sport"] },
  "היסטוריה": { cats: ["historic"] },
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

// Re-rank attractions by taste (primary), then must-see, and — ONLY for trips
// with kids — family fit (family_score, overridden by the editor's kids rating).
// It's gated on `isFamily`; couples'/friends' trips rank by taste + must-see
// only. Returns the top `n`; falls back to source order when there's no taste.
export function rankByTaste(
  attractions: Attraction[],
  taste: Record<string, number> | undefined,
  n: number,
  isFamily = false
): Attraction[] {
  if (!taste || Object.keys(taste).length === 0) return attractions.slice(0, n);
  const scored = attractions.map((a) => ({
    a,
    s: tasteScore(a.taste_tags, taste) * 3
      + (isFamily ? familyFit(a) : 0)
      + (a.must_see === 1 ? 2 : 0),
  }));
  scored.sort((x, y) => y.s - x.s);
  return scored.map((x) => x.a).slice(0, n);
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
