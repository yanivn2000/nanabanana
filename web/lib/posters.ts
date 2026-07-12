// City posters — hand-generated modern travel-poster art (brand palette),
// stored as static assets in /public/posters/. Each city has up to three crops:
//   <slug>-4x2.jpg (banner 2:1, for the wide header bands/heroes),
//   <slug>-4x3.jpg (landscape) and
//   <slug>-3x4.jpg (portrait, for tall cards/thumbnails).
// Only cities listed here have art; everything else uses CityPoster's brand
// gradient. Drop the jpgs + add the id to light a city up.
// All 25 destinations mapped to a slug. Cities whose <slug>-*.jpg files exist
// show the poster; the rest fall back to the brand gradient until their art is
// dropped in (no 404 breakage — CityPoster handles it). Done: london, paris,
// barcelona, rome, amsterdam, berlin, prague, budapest.
export const POSTER_SLUG: Record<number, string> = {
  1: "vienna",
  2: "salzburg",
  3: "rome",
  4: "athens",
  5: "budapest",
  6: "prague",
  7: "barcelona",
  8: "amsterdam",
  9: "berlin",
  10: "thessaloniki",
  11: "larnaca",
  12: "batumi",
  13: "tel-aviv",
  14: "london",
  15: "paris",
  16: "lisbon",
  17: "madrid",
  18: "milan",
  19: "venice",
  20: "florence",
  21: "munich",
  22: "zurich",
  23: "tbilisi",
  24: "nice",
  25: "rhodes",
};

// Ordered candidate srcs: the preferred crop first, the others as fallbacks
// (a city may have only some crops). Empty when the city has no poster.
export function posterSrcs(
  destinationId: number | null | undefined,
  prefer: "banner" | "landscape" | "portrait" = "landscape"
): string[] {
  if (destinationId == null) return [];
  const slug = POSTER_SLUG[destinationId];
  if (!slug) return [];
  const banner = `/posters/${slug}-4x2.jpg`;
  const land = `/posters/${slug}-4x3.jpg`;
  const port = `/posters/${slug}-3x4.jpg`;
  return prefer === "portrait" ? [port, land, banner]
    : prefer === "banner" ? [banner, land, port]
    : [land, banner, port];
}
