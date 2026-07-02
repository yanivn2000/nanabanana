// Money-saving regional / city tourist passes (#16). Shown as a small badge on
// a destination when a relevant pass exists; clicking reveals the pass + a link.
// `url` is a plain search link for now — safe and always valid; can be swapped
// for an affiliate link later.
export type Pass = { name: string; cities: string[]; note_he: string };

// City names match the destinations' English `city` (incl. our "Greater London").
export const PASSES: Pass[] = [
  // --- city cards for the big destinations we already have ---
  { name: "I amsterdam City Card", cities: ["Amsterdam"], note_he: "תחבורה ציבורית חופשית + כניסה למוזיאונים מרכזיים ושייט תעלות" },
  { name: "Paris Pass", cities: ["Paris"], note_he: "כניסה ל-70+ אטרקציות ומוזיאונים + דילוג על תורים" },
  { name: "The London Pass", cities: ["London", "Greater London"], note_he: "כניסה ל-90+ אטרקציות בלונדון + דילוג על תורים" },
  { name: "Roma Pass", cities: ["Rome"], note_he: "תחבורה חופשית + כניסה חינם ל-1-2 אתרים והנחות" },
  { name: "Barcelona Card", cities: ["Barcelona"], note_he: "תחבורה ציבורית חופשית + כניסה חינם/מוזלת למוזיאונים" },
  { name: "Prague CoolPass", cities: ["Prague"], note_he: "כניסה ל-70+ אטרקציות בפראג + הנחות" },
  { name: "Budapest Card", cities: ["Budapest"], note_he: "תחבורה חופשית + מרחצאות והנחות לאטרקציות" },
  { name: "Lisboa Card", cities: ["Lisbon"], note_he: "תחבורה חופשית (כולל לסינטרה) + כניסה חינם למוזיאונים" },
  { name: "Vienna Pass", cities: ["Vienna"], note_he: "כניסה ל-90+ אטרקציות בווינה + אוטובוס Hop-on Hop-off" },
  { name: "Berlin WelcomeCard", cities: ["Berlin"], note_he: "תחבורה ציבורית חופשית + הנחות ל-180+ אטרקציות" },
  { name: "Athens City Pass", cities: ["Athens"], note_he: "כניסה לאקרופוליס ולאתרים + אוטובוס תיירים" },

  // --- regional passes from the ticket (light up when we add those cities) ---
  { name: "SalzburgerLand Card", cities: ["Salzburg"], note_he: "כניסה חופשית ל-190+ אטרקציות באזור זלצבורג" },
  { name: "Tirol Regio Card", cities: ["Innsbruck"], note_he: "תחבורה ואטרקציות באזור טירול" },
  { name: "Kärnten Card", cities: ["Klagenfurt", "Villach"], note_he: "100+ אטרקציות בקרינתיה" },
  { name: "Schladming-Dachstein Sommercard", cities: ["Schladming"], note_he: "אטרקציות ורכבלים באזור דכשטיין" },
  { name: "SchwarzwaldCard", cities: ["Freiburg"], note_he: "כניסה חופשית לאטרקציות ביער השחור" },
  { name: "Südtirol Guest Pass", cities: ["Bolzano", "Bozen"], note_he: "תחבורה ציבורית חופשית בדרום טירול" },
  { name: "Garda Guest Card", cities: ["Garda", "Peschiera del Garda"], note_he: "הנחות באזור אגם גארדה" },
  { name: "Aosta Valley Card", cities: ["Aosta"], note_he: "אטרקציות ורכבלים בעמק אאוסטה" },
  { name: "Jungfrau Travel Pass", cities: ["Interlaken"], note_he: "נסיעות חופשיות ברשת יונגפראו" },
  { name: "Tell-Pass", cities: ["Lucerne", "Luzern"], note_he: "תחבורה ורכבלים במרכז שווייץ" },
  { name: "Peak Pass", cities: ["Zermatt"], note_he: "רכבלים ותחבורה בצרמט" },
  { name: "Mont Blanc Multipass", cities: ["Chamonix"], note_he: "רכבלים באזור מון בלאן" },
  { name: "Copenhagen Card", cities: ["Copenhagen"], note_he: "תחבורה חופשית + 80+ אטרקציות" },
  { name: "Go City Stockholm", cities: ["Stockholm"], note_he: "כניסה ל-45+ אטרקציות בשטוקהולם" },
  { name: "Tallinn Card", cities: ["Tallinn"], note_he: "תחבורה חופשית + 40+ אטרקציות" },
];

export function passUrl(name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(name)}`;
}

export function passesForCity(city?: string | null, cityHe?: string | null): Pass[] {
  const keys = new Set([city, cityHe].filter(Boolean).map((s) => s!.toLowerCase()));
  return PASSES.filter((p) => p.cities.some((c) => keys.has(c.toLowerCase())));
}
