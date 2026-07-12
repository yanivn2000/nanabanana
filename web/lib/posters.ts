// City posters — hand-generated modern travel-poster art (brand palette),
// stored as static assets in /public/posters/. Each city has up to two crops:
//   <slug>-4x3.jpg (landscape, for wide bands/heroes) and
//   <slug>-3x4.jpg (portrait, for tall cards/thumbnails).
// Only cities listed here have art; everything else uses CityPoster's brand
// gradient. Drop the jpgs + add the id to light a city up.
export const POSTER_SLUG: Record<number, string> = {
  14: "london",
  15: "paris",
  7: "barcelona",
  3: "rome",
  8: "amsterdam",
  9: "berlin",
  6: "prague",
  5: "budapest",
};

// Ordered candidate srcs: the preferred orientation first, the other as a
// fallback (a city may have only one crop). Empty when the city has no poster.
export function posterSrcs(
  destinationId: number | null | undefined,
  prefer: "landscape" | "portrait" = "landscape"
): string[] {
  if (destinationId == null) return [];
  const slug = POSTER_SLUG[destinationId];
  if (!slug) return [];
  const land = `/posters/${slug}-4x3.jpg`;
  const port = `/posters/${slug}-3x4.jpg`;
  return prefer === "portrait" ? [port, land] : [land, port];
}
