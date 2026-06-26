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
