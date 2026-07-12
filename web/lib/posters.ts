// City posters — hand-generated modern travel-poster art (brand palette),
// stored as static assets in /public/posters/<slug>.jpg. Only cities that have
// a poster are listed; everything else falls back to CityPoster's brand
// gradient. Drop a new <slug>.jpg + add the id here to light a city up.
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

export function posterSrc(destinationId?: number | null): string | null {
  if (destinationId == null) return null;
  const slug = POSTER_SLUG[destinationId];
  return slug ? `/posters/${slug}.jpg` : null;
}
