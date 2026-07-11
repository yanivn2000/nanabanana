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
  "חופים": ["nature"],
  "פארקי שעשועים": ["family"],
  "היסטוריה": ["history", "landmark"],
  // finer taste chips (added to the editor for real divergence):
  "מוזיקה חיה": ["live_music"],
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

// Re-rank attractions by taste (primary) then family_score/must-see (tiebreak),
// and return the top `n`. Falls back to family-order when no taste signal
// (e.g. a city not taste-tagged yet, or an empty taste model).
export function rankByTaste(
  attractions: Attraction[],
  taste: Record<string, number> | undefined,
  n: number
): Attraction[] {
  if (!taste || Object.keys(taste).length === 0) return attractions.slice(0, n);
  const scored = attractions.map((a) => ({
    a,
    s: tasteScore(a.taste_tags, taste) * 3
      + (a.family_score ?? 0)
      + (a.must_see === 1 ? 2 : 0),
  }));
  scored.sort((x, y) => y.s - x.s);
  return scored.map((x) => x.a).slice(0, n);
}

// Top-weighted taste tags → a short Hebrew emphasis line for the AI prompt.
const TAG_HE: Record<string, string> = {
  live_music: "מוזיקה חיה", nightlife: "חיי לילה", vintage_shopping: "שווקי וינטג'",
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
