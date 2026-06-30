import type { FamilyProfile } from "./store";

export type PackItem = { id: string; label: string };
export type PackSection = { section: string; items: PackItem[] };
export type PackingState = { checked: string[]; removed: string[]; custom: PackItem[] };

// Plug/adapter type by country (so we suggest the right travel adapter).
const PLUG: Record<string, string> = {
  "United Kingdom": "Type G (בריטניה)", Ireland: "Type G",
  Switzerland: "Type J (שווייץ)", Italy: "Type C/F/L",
  Israel: "Type H (ישראל)",
};
function plug(country?: string | null): string {
  return (country && PLUG[country]) || "Type C/F (אירופה)";
}

function seasonOf(month?: number): "winter" | "summer" | "spring" | "autumn" | null {
  if (!month) return null;
  if ([12, 1, 2].includes(month)) return "winter";
  if ([3, 4, 5].includes(month)) return "spring";
  if ([6, 7, 8].includes(month)) return "summer";
  return "autumn";
}

// Build a smart packing template from the trip's travelers, season, days, country.
export function buildPackingList(
  profile: FamilyProfile, month: number | undefined, days: number, country?: string | null
): PackSection[] {
  const travelers = profile.adults + profile.kids.length;
  const u = days + 1;                       // underwear / socks
  const shirts = Math.max(2, days);
  const pants = Math.max(1, Math.ceil(days / 2));
  const youngKids = profile.kids.some((k) => k.age <= 3);
  const babies = profile.kids.some((k) => k.age <= 1);
  const season = seasonOf(month);

  const docs: PackItem[] = [
    { id: "doc-passport", label: `דרכונים בתוקף (×${travelers})` },
    { id: "doc-flights", label: "כרטיסי טיסה / אישורי צ׳ק-אין" },
    { id: "doc-hotel", label: "אישורי הזמנת מלונות" },
    { id: "doc-insurance", label: "ביטוח נסיעות לחו״ל" },
    { id: "doc-money", label: "כרטיס אשראי + מזומן במטבע מקומי" },
  ];

  const clothing: PackItem[] = [
    { id: "cloth-underwear", label: `תחתונים — ${u} לכל נוסע` },
    { id: "cloth-socks", label: `גרביים — ${u} לכל נוסע` },
    { id: "cloth-shirts", label: `חולצות — ${shirts} לכל נוסע` },
    { id: "cloth-pants", label: `מכנסיים — ${pants} לכל נוסע` },
    { id: "cloth-pajamas", label: "פיג׳מה" },
    { id: "cloth-shoes", label: "נעליים נוחות להליכה" },
  ];

  const seasonItems: PackItem[] =
    season === "winter" ? [
      { id: "s-coat", label: "מעיל חם" }, { id: "s-hat", label: "כובע + כפפות + צעיף" },
      { id: "s-thermal", label: "שכבה תרמית" },
    ] : season === "summer" ? [
      { id: "s-swim", label: "בגד ים + מגבת" }, { id: "s-sun", label: "כובע שמש + משקפי שמש" },
      { id: "s-sunscreen", label: "קרם הגנה" }, { id: "s-sandals", label: "סנדלים" },
    ] : [
      { id: "s-jacket", label: "מעיל קל / שכבות" }, { id: "s-umbrella", label: "מטרייה / מעיל גשם" },
    ];

  const toiletries: PackItem[] = [
    { id: "t-toothbrush", label: `מברשות שיניים (×${travelers})` },
    { id: "t-toothpaste", label: "משחת שיניים" },
    { id: "t-shampoo", label: "שמפו + סבון" },
    { id: "t-deodorant", label: "דאודורנט" },
    { id: "t-meds", label: "תרופות אישיות + קופסת עזרה ראשונה" },
    { id: "t-wipes", label: "מגבונים לחים" },
  ];

  const electronics: PackItem[] = [
    { id: "e-chargers", label: "מטענים לטלפונים" },
    { id: "e-adapter", label: `מתאם חשמל — ${plug(country)}` },
    { id: "e-powerbank", label: "סוללה ניידת (פאוורבנק)" },
    { id: "e-headphones", label: "אוזניות" },
  ];

  const kids: PackItem[] = profile.kids.length ? [
    { id: "k-snacks", label: "חטיפים ובקבוקי מים לדרך" },
    { id: "k-games", label: "משחקים / טאבלט להעסקה" },
    ...(youngKids ? [{ id: "k-stroller", label: "עגלה / מנשא" }] : []),
    ...(babies ? [
      { id: "k-diapers", label: "חיתולים + מגבונים" },
      { id: "k-pacifier", label: "מוצץ + בקבוקים" },
    ] : []),
  ] : [];

  return [
    { section: "מסמכים", items: docs },
    { section: "ביגוד", items: clothing },
    ...(seasonItems.length ? [{ section: season === "winter" ? "לחורף" : season === "summer" ? "לקיץ" : "למזג אוויר משתנה", items: seasonItems }] : []),
    { section: "טואלטיקה", items: toiletries },
    { section: "אלקטרוניקה", items: electronics },
    ...(kids.length ? [{ section: "לילדים", items: kids }] : []),
  ];
}
