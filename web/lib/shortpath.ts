import type { Attraction } from "./db";

// The short curated path — "what people like you loved". For a profile, keep the
// audience-eligible places (fit >= floor), rank by consensus = worthiness × fit,
// take the top N. Optional taste boosts re-rank within. Pure + client-safe
// (types only) so DestinationView can compute it live from the loaded data.

export type Profile = "families" | "couples" | "friends";
export const PROFILES: Profile[] = ["families", "couples", "friends"];
export const PROFILE_HE: Record<Profile, string> = { families: "משפחות", couples: "זוגות", friends: "חברים" };
export const PROFILE_EMOJI: Record<Profile, string> = { families: "👨‍👩‍👧", couples: "💑", friends: "🎉" };

const FIT_FLOOR = 35; // below this, the place is not shown for that audience at all

// Interests for the taste tilt (boost within the audience-eligible set).
export const INTERESTS: { key: string; label: string; emoji: string; match: (a: Attraction) => boolean }[] = [
  { key: "museum", label: "מוזיאונים ואמנות", emoji: "🖼️", match: (a) => a.category === "museum" || a.audience_fit?.type === "cultural" },
  { key: "food", label: "אוכל ושווקים", emoji: "🍽️", match: (a) => a.audience_fit?.type === "foodie" },
  { key: "nature", label: "טבע ופארקים", emoji: "🌳", match: (a) => a.category === "nature" || a.audience_fit?.type === "outdoors" },
  { key: "family", label: "חוויה ומשפחה", emoji: "🎡", match: (a) => a.audience_fit?.type === "family" },
  { key: "culture", label: "אווירה והיסטוריה", emoji: "🎭", match: (a) => ["cultural", "social", "hidden_gem"].includes(a.audience_fit?.type ?? "") },
];

// curation (editor-must / must_see) IS the notability signal when traveller data is thin
function curation(a: Attraction): number {
  if (a.must_see === 1) return 1;
  if (a.editor_rank === "maybe") return 0.5;
  return 0;
}

export type ShortPathItem = { a: Attraction; score: number; boosted: boolean };

export function shortPath(
  attractions: Attraction[], travCount: (id: number) => number,
  profile: Profile, boosts: Set<string>, n = 24
): { path: ShortPathItem[]; excluded: number; eligible: number } {
  const withFit = attractions.filter((a) => a.audience_fit && a.editor_rank !== "no");
  const maxTrav = Math.max(1, ...withFit.map((a) => travCount(a.id)));
  const worth = (a: Attraction) => {
    const t = travCount(a.id);
    const ts = t ? Math.log1p(t) / Math.log1p(maxTrav) : 0;
    return Math.min(1, 0.10 + 0.28 * ts + 0.28 * (a.notable ? 1 : 0) + 0.34 * curation(a));
  };
  const consensus = (a: Attraction) => Math.round(100 * worth(a) * ((a.audience_fit![profile] ?? 0) / 100));
  const eligible = withFit.filter((a) => (a.audience_fit![profile] ?? 0) >= FIT_FLOOR);
  const boostMatch = (a: Attraction) =>
    boosts.size > 0 && [...boosts].some((k) => INTERESTS.find((i) => i.key === k)?.match(a));
  const scored = eligible.map((a) => ({ a, base: consensus(a), boosted: boostMatch(a) }));
  scored.sort((x, y) => (y.base + (y.boosted ? 20 : 0)) - (x.base + (x.boosted ? 20 : 0)));
  return {
    path: scored.slice(0, n).map((s) => ({ a: s.a, score: s.base, boosted: s.boosted })),
    excluded: withFit.length - eligible.length,
    eligible: eligible.length,
  };
}
