// Sample itinerary data — stands in until Phase 2 wires Claude-generated trips.

export type Stop = {
  name: string;
  kind: "nature" | "food" | "culture" | "rest" | "shopping";
  time: string;
  duration: string;
  score?: number;
  note?: string;
};

export type Day = {
  label: string;
  date: string;
  base: string;
  stops: Stop[];
  why?: string;
};

export type Trip = {
  id: string;
  title: string;
  subtitle: string;
  country: string;
  days: number;
  travellers: string;
  tags: string[];
  cover: string; // emoji for now
  itinerary: Day[];
};

export const SAMPLE_TRIP: Trip = {
  id: "austria-family",
  title: "אוסטריה עם הילדים",
  subtitle: "זלצבורג · הלשטאט · וינה",
  country: "אוסטריה",
  days: 8,
  travellers: "משפחת נוריאל · 4 נוסעים",
  tags: ["טבע", "ילדים 7+10", "עד שעה נסיעה ביום", "תקציב בינוני"],
  cover: "🏔️",
  itinerary: [
    {
      label: "יום 3",
      date: "רביעי",
      base: "זלצבורג",
      why: "שמרתי את המצודה לסוף — היא 7 דקות מהמלון, אז הילדים יכולים לנוח אחריה. דילגתי על מוזיאון מוצרט כי ציינתם שלא אוהבים מוזיאונים.",
      stops: [
        { name: "מצוק ההר Untersberg", kind: "nature", time: "09:30", duration: "2.5 שעות", score: 9, note: "רכבל לפסגה — נוף מטורף, מתאים לילדים" },
        { name: "ארוחת צהריים · Stiegl-Keller", kind: "food", time: "12:45", duration: "שעה", note: "ידידותי לילדים, מנות גדולות" },
        { name: "מצודת הוהנזלצבורג", kind: "culture", time: "14:30", duration: "2 שעות", score: 8, note: "פנים וחוץ — טוב גם אם יורד גשם" },
        { name: "גלידה ב-Altstadt", kind: "rest", time: "17:00", duration: "45 דק׳", note: "הליכה ברגל מהמצודה" },
      ],
    },
    {
      label: "יום 4",
      date: "חמישי",
      base: "הלשטאט",
      why: "יום נסיעה קצר (שעה ורבע) להלשטאט. בוקר רגוע כי אתמול היה אינטנסיבי.",
      stops: [
        { name: "נסיעה להלשטאט", kind: "rest", time: "10:00", duration: "1:15 שעות", note: "עצירת נוף בדרך באגם" },
        { name: "כפר הלשטאט + מעבורת", kind: "nature", time: "12:00", duration: "3 שעות", score: 10, note: "הכפר הכי מצולם באוסטריה" },
        { name: "מכרה המלח Salzwelten", kind: "culture", time: "15:30", duration: "2 שעות", score: 8, note: "מגלשה תת-קרקעית — הילדים יתות'ו" },
      ],
    },
  ],
};

export const KIND_META: Record<
  Stop["kind"],
  { label: string; icon: string; color: string; soft: string }
> = {
  nature: { label: "טבע", icon: "mountain", color: "var(--brand-ink)", soft: "var(--brand-soft)" },
  food: { label: "אוכל", icon: "utensils", color: "var(--amber)", soft: "var(--amber-soft)" },
  culture: { label: "תרבות", icon: "landmark", color: "var(--blue)", soft: "var(--blue-soft)" },
  rest: { label: "מנוחה", icon: "coffee", color: "var(--text-2)", soft: "var(--surface-2)" },
  shopping: { label: "קניות", icon: "shopping-bag", color: "var(--blue)", soft: "var(--blue-soft)" },
};
