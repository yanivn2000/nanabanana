import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getModel } from "./db";
import type { Attraction } from "./db";
import type { Itinerary } from "./trip-types";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client() {
  return new Anthropic(); // reads ANTHROPIC_API_KEY from env
}

// Structured-outputs schema Claude must return.
const STOP_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    kind: { type: "string", enum: ["nature", "food", "culture", "rest", "shopping"] },
    time: { type: "string" },
    duration: { type: "string" },
    score: { type: "integer" },
    note: { type: "string" },
  },
  required: ["name", "kind", "time", "duration", "score", "note"],
  additionalProperties: false,
};
const ITINERARY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          date: { type: "string" },
          base: { type: "string" },
          why: { type: "string" },
          stops: { type: "array", items: STOP_SCHEMA },
        },
        required: ["label", "date", "base", "why", "stops"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "subtitle", "days"],
  additionalProperties: false,
};

const SYSTEM = `אתה מתכנן טיולים מומחה לאפליקציה ישראלית למשפחות שטסות לחו"ל.
אתה בונה לו"ז יומי מאוזן וריאליסטי — לא רשימה של אטרקציות, אלא תוכנית עם שעות, זמני נסיעה, ארוחות ופינות מנוחה.
כל הטקסט בעברית טבעית (שמות מקומות: השם שישראלים משתמשים בו, עם השם הלועזי בסוגריים אם עוזר).
חוקים:
- כבד את פרופיל המשפחה: גילאי הילדים, תחומי עניין, מה שלא אוהבים, קצב, תקציב, מרחק נסיעה יומי מקסימלי.
- אל תעמיס יותר מ-3-4 עצירות משמעותיות ביום עם ילדים. שלב מנוחה ואוכל.
- לכל יום כתוב שדה "why" קצר (משפט-שניים) שמסביר את ההיגיון: למה הסדר הזה, על מה דילגת ולמה. זה הערך המרכזי של האפליקציה.
- kind: nature/food/culture/rest/shopping. score=1-10 כמה האטרקציה מתאימה למשפחה הזו. note=משפט קצר מעשי.
- בחר רק מהאטרקציות שסופקו. אל תמציא מקומות.`;

function attractionsBlock(attractions: Attraction[]): string {
  return attractions
    .map((a) =>
      JSON.stringify({
        name: a.name_he || a.name_en,
        en: a.name_en,
        category: a.category,
        sub: a.subcategory,
        indoor_outdoor: a.indoor_outdoor,
        score: a.family_score,
        tip: a.tips_he,
      })
    )
    .join("\n");
}

async function callClaude(userText: string): Promise<Itinerary> {
  const resp = await client().messages.create({
    model: getModel(),
    max_tokens: 8000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: ITINERARY_SCHEMA } },
    messages: [{ role: "user", content: userText }],
    // eslint not needed; types from SDK
  } as Anthropic.MessageCreateParamsNonStreaming);

  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no text block");
  return JSON.parse(block.text) as Itinerary;
}

export type TripHotel = { name: string; city: string; lat: number; lng: number };

export type GenerateParams = {
  city: string;
  country: string;
  days: number;
  profileText: string;
  attractions: Attraction[];
  hotels?: TripHotel[];
};

function hotelsBlock(hotels?: TripHotel[]): string {
  if (!hotels || hotels.length === 0) return "";
  const lines = hotels.map((h) => `- ${h.name} (${h.city}) [${h.lat},${h.lng}]`).join("\n");
  return `\nהמשפחה כבר הזמינה את המלונות הבאים — בנה טיול כוכב: כל יום סובב סביב בסיס הלינה, עם טיולי-יום לאטרקציות בטווח הנסיעה היומי. סדר את הימים כדי למזער נסיעה:\n${lines}\n`;
}

export async function generateItinerary(p: GenerateParams): Promise<Itinerary> {
  const userText = `בנה לו"ז טיול ל${p.city}, ${p.country}.
מספר ימים: ${p.days}
פרופיל המשפחה: ${p.profileText}
${hotelsBlock(p.hotels)}
אטרקציות זמינות (בחר מתוכן בלבד):
${attractionsBlock(p.attractions)}`;
  return callClaude(userText);
}

export async function reviseItinerary(
  current: Itinerary,
  instruction: string,
  attractions: Attraction[],
  profileText?: string
): Promise<Itinerary> {
  const userText = `זהו הלו"ז הנוכחי:
${JSON.stringify(current, null, 1)}
${profileText ? `\nפרופיל המשפחה: ${profileText}\n` : ""}
בקשת המשתמש לשינוי: "${instruction}"

ארגן מחדש את הלו"ז לפי הבקשה. שמור על מה שעובד, שנה רק מה שצריך, ועדכן את שדה ה-"why" של הימים שהשתנו כדי להסביר את השינוי.
אם רלוונטי, בחר אטרקציות חלופיות מהרשימה:
${attractionsBlock(attractions)}`;
  return callClaude(userText);
}
