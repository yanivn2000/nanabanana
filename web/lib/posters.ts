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

// Landmark-anchored Pexels search per city — used by the admin poster picker to
// surface iconic, recognisable candidates (not generic "city" shots).
export const POSTER_QUERY: Record<number, string> = {
  1: "Vienna Belvedere palace skyline",
  2: "Salzburg old town fortress river",
  3: "Rome Colosseum skyline",
  4: "Athens Acropolis Parthenon",
  5: "Budapest parliament Danube river",
  6: "Prague old town Charles Bridge",
  7: "Barcelona Sagrada Familia skyline",
  8: "Amsterdam canal houses",
  9: "Berlin Brandenburg Gate",
  10: "Thessaloniki White Tower waterfront",
  11: "Larnaca Cyprus palm promenade seafront",
  12: "Batumi Georgia Black Sea skyline",
  13: "Tel Aviv beach skyline Mediterranean",
  14: "London Big Ben Westminster Thames",
  15: "Paris Eiffel Tower skyline",
  16: "Lisbon tram Alfama viewpoint",
  17: "Madrid Gran Via Plaza Mayor",
  18: "Milan Duomo cathedral",
  19: "Venice Grand Canal gondola",
  20: "Florence Duomo skyline Arno",
  21: "Munich Marienplatz old town",
  22: "Zurich lake old town Alps",
  23: "Tbilisi old town Narikala",
  24: "Nice French Riviera Promenade des Anglais",
  25: "Rhodes old town medieval harbour Greece",
};

// Ordered candidate srcs: the preferred crop first, the other as fallback.
// Real-photo posters ship in two crops — 4x2 (wide) and 3x4 (tall); the old 4x3
// "landscape" crops were retired, so both banner and landscape use the wide 4x2.
// Empty when the city has no poster.
export function posterSrcs(
  destinationId: number | null | undefined,
  prefer: "banner" | "landscape" | "portrait" = "landscape"
): string[] {
  if (destinationId == null) return [];
  const slug = POSTER_SLUG[destinationId];
  if (!slug) return [];
  const banner = `/posters/${slug}-4x2.jpg`;   // wide real photo
  const port = `/posters/${slug}-3x4.jpg`;     // tall real photo
  return prefer === "portrait" ? [port, banner] : [banner, port];
}
