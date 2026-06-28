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
  food: "אוכל", shopping: "קניות", tourism: "תיירות", leisure: "פנאי", historic: "אתר היסטורי",
};

// Best available memorable line: AI tagline → subcategory → category.
export function descriptor(a: Attraction): string {
  if (a.tagline_he) return a.tagline_he;
  if (a.subcategory && SUB_HE[a.subcategory]) return SUB_HE[a.subcategory];
  return CAT_HE[a.category] ?? a.category;
}

export function categoryHe(c: string): string {
  return CAT_HE[c] ?? c;
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
  return CAT_COLOR[c] ?? "#8a8780";
}
