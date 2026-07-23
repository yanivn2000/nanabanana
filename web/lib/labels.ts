import type { Attraction } from "./db";

// Hebrew label for an OSM subcategory — a memorable descriptor without AI.
const SUB_HE: Record<string, string> = {
  zoo: "גן חיות",
  theme_park: "פארק שעשועים",
  water_park: "פארק מים",
  aquarium: "אקווריום",
  museum: "מוזיאון",
  gallery: "גלריה",
  castle: "טירה",
  monument: "אנדרטה",
  memorial: "אתר הנצחה",
  viewpoint: "נקודת תצפית",
  peak: "פסגת הר",
  waterfall: "מפל",
  park: "פארק",
  nature_reserve: "שמורת טבע",
  attraction: "אטרקציה",
};

const CAT_HE: Record<string, string> = {
  nature: "טבע", museum: "מוזיאון", attraction: "אטרקציה", sport: "ספורט",
  food: "אוכל", shopping: "קניות", tourism: "תיירות", leisure: "פנאי", historic: "היסטורי",
};

// Fold near-duplicate categories into one bucket for display/filtering.
// Tourism sites are effectively historic landmarks, so merge them together.
const CAT_MERGE: Record<string, string> = { tourism: "historic" };
export function mergeCat(c: string): string {
  return CAT_MERGE[c] ?? c;
}

// Best available memorable line: AI tagline → subcategory → category.
export function descriptor(a: Attraction): string {
  if (a.tagline_he) return a.tagline_he;
  if (a.subcategory && SUB_HE[a.subcategory]) return SUB_HE[a.subcategory];
  return CAT_HE[mergeCat(a.category)] ?? a.category;
}

export function categoryHe(c: string): string {
  return CAT_HE[mergeCat(c)] ?? c;
}

// Marker/legend colour per category — shared by the map and the filter legend.
export const CAT_COLOR: Record<string, string> = {
  nature: "#1d9e75",
  attraction: "#d85a30",
  museum: "#185fa5",
  sport: "#ba7517",
  food: "#7f77dd",
  shopping: "#d4537e",
  historic: "#8a6d45",
  tourism: "#2aa198",
  leisure: "#639922",
};
export function catColor(c: string): string {
  return CAT_COLOR[mergeCat(c)] ?? "#8a8780";
}

// Distinct colour per trip segment (leg) — shared by the map pins and the legend.
export const SEG_PALETTE = ["#185fa5", "#d85a30", "#1d9e75", "#7f77dd", "#ba7517", "#d4537e"];
export function segColor(i: number): string {
  const n = SEG_PALETTE.length;
  return SEG_PALETTE[((i % n) + n) % n];
}

// One distinct, accessible colour per STOP in a day — the visual thread that
// ties a stop's map marker, its route segment, its timeline dot and its legend
// row together so the day reads as one system. Muted enough to sit on a light
// map, a white card and a cream page, and to carry white numerals (AA).
export const STOP_PALETTE = [
  "#2563A6", "#7357C8", "#E96A2C", "#4D9B55",
  "#168C83", "#C94B74", "#C19332", "#566273",
];
export function stopColor(i: number): string {
  const n = STOP_PALETTE.length;
  return STOP_PALETTE[((i % n) + n) % n];
}

// Group destinations under regions (ticket #14). Maps a country (English, as
// stored) to a Hebrew region; REGION_ORDER sets the display order.
const COUNTRY_REGION: Record<string, string> = {
  Germany: "מרכז אירופה", Austria: "מרכז אירופה", Czechia: "מרכז אירופה",
  "Czech Republic": "מרכז אירופה", Hungary: "מרכז אירופה", Switzerland: "מרכז אירופה",
  France: "מערב אירופה", Netherlands: "מערב אירופה", "United Kingdom": "מערב אירופה",
  Spain: "מערב אירופה", Portugal: "מערב אירופה",
  Italy: "דרום אירופה", Greece: "דרום אירופה", Cyprus: "דרום אירופה",
  Georgia: "מזרח אירופה וקווקז",
  Israel: "ישראל",
};
export const REGION_ORDER = [
  "מערב אירופה", "מרכז אירופה", "דרום אירופה", "מזרח אירופה וקווקז", "ישראל", "אחר",
];
export function regionOf(country: string | null | undefined): string {
  return (country && COUNTRY_REGION[country]) || "אחר";
}

// Flag emoji per country (English name as stored) — a small, friendly cue in
// the city hero. Falls back to a globe when we don't have a mapping.
const COUNTRY_FLAG: Record<string, string> = {
  Germany: "🇩🇪", Austria: "🇦🇹", Czechia: "🇨🇿", "Czech Republic": "🇨🇿",
  Hungary: "🇭🇺", Switzerland: "🇨🇭", France: "🇫🇷", Netherlands: "🇳🇱",
  "United Kingdom": "🇬🇧", Spain: "🇪🇸", Portugal: "🇵🇹", Italy: "🇮🇹",
  Greece: "🇬🇷", Cyprus: "🇨🇾", Georgia: "🇬🇪", Israel: "🇮🇱",
};
export function countryFlag(country: string | null | undefined): string {
  return (country && COUNTRY_FLAG[country]) || "🌍";
}

// Request a larger Wikimedia image for the expanded view. Two URL shapes:
//  - Commons FilePath "?width=" → regenerates from the original (serves the
//    original if smaller), so upscaling never fails.
//  - upload.wikimedia "/thumb/.../NNNpx-Name" thumbnails → bump the NNNpx to a
//    bigger render so the banner isn't a blurry upscale of a ~320px thumb. If the
//    requested width exceeds the source Wikimedia returns 400, but every <img>
//    that uses bigImage has an onError that falls back to the stored URL, so the
//    worst case is simply the old (small) image — never a broken one.
// Only ENLARGE (never shrink a thumbnail that's already bigger than px).
export function bigImage(url: string | null | undefined, px = 640): string | undefined {
  if (!url) return undefined;
  if (/[?&]width=\d+/.test(url)) return url.replace(/([?&]width=)\d+/, `$1${px}`);
  const m = url.match(/\/(\d+)px-/);
  if (m && Number(m[1]) < px) return url.replace(/\/\d+px-/, `/${px}px-`);
  return url;
}
