import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getModel } from "./db";
import type { Attraction, DestinationSummary, Insight } from "./db";
import type { Itinerary } from "./trip-types";
import { clusterIntoDays, dayWalkMinutes } from "./cluster";

// A deterministic geographic hint: cluster the candidate places into walkable
// day-neighbourhoods (route-first, cluster-second) and hand the grouping to the
// model as strong advice. This makes proximity a real weight in the AI plan —
// days come out tight and walkable instead of zig-zagging the city — while the
// model still owns selection, timing, "why", and the verified insights.
function proximityBlock(pool: Attraction[], days: number, walkPref?: number): string {
  const { days: clusters } = clusterIntoDays(pool, days, { walkPref });
  if (clusters.length < 2) return "";
  const lines = clusters.map((c, i) =>
    `אזור ${i + 1} (כ-${Math.round(dayWalkMinutes(c))} דק׳ הליכה בסך הכול): ${c.map((a) => a.name_he || a.name_en).join(" · ")}`);
  return `\nרמז גיאוגרפי (חשוב לחוויה!): קיבצנו את המקומות לאזורים הליכתיים כדי לצמצם נסיעות — ככה מספיקים יותר בכל יום וההליכה עצמה נעימה. בנֵה כל יום בתוך אזור אחד וסדר את העצירות כמסלול הליכה רציף (מהקרוב לקרוב). מותר לחרוג רק אם יש סיבה אמיתית (שעות פתיחה/אירוע) — אך אל תפזר יום אחד על פני קצוות מרוחקים של העיר:\n${lines.join("\n")}\n`;
}

const KIND_HE_INS: Record<string, string> = {
  tip: "טיפ", warning: "אזהרה", verdict: "שווה/לא שווה",
  food: "אוכל", season: "עונה", access: "נגישות",
};

// Verified real-traveller knowledge — trusted ABOVE generic model knowledge.
// Distilled + team-approved in the admin; injected here with top priority.
function verifiedBlock(insights: Insight[] | undefined, attractions: Attraction[]): string {
  if (!insights || insights.length === 0) return "";
  const nameById = new Map(attractions.map((a) => [a.id, a.name_he || a.name_en]));
  const lines = insights.map((v) => {
    const place = v.attraction_id != null ? nameById.get(v.attraction_id) ?? v.place_name : v.place_name;
    return `- [${KIND_HE_INS[v.kind] ?? v.kind}] ${place ? place + ": " : ""}${v.text_he}`;
  });
  return `\n**ידע אמת ממטיילים אמיתיים (עדיפות עליונה — סמוך על זה יותר מכל ידע כללי):**
המידע הבא נאסף מדיווחים של מטיילים אמיתיים ואומת ידנית על ידי הצוות. תן לו משקל גבוה מכל ידע כללי: אם תובנה ממליצה על מקום — קדם אותו; אם מזהירה — הימנע או תזמן בהתאם; ושלב את העצה הרלוונטית בשדה note/why של היום המתאים.
${lines.join("\n")}\n`;
}

// AI is a HARD OPT-IN. It's available only when a key exists AND AI_ENABLED=true is
// set explicitly. Default (no flag) = OFF, so a commercial deployment never spends a
// paid Claude call: generate falls back to the deterministic engine and revise is
// handled by reviseHeuristic. Flip AI_ENABLED=true only to re-enable the AI upgrade.
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AI_ENABLED === "true";
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

const SYSTEM = `אתה מתכנן טיולים מומחה לאפליקציה ישראלית למטיילים בחו"ל — זוגות, חבורות חברים ומשפחות כאחד.
אתה בונה לו"ז יומי מאוזן וריאליסטי — לא רשימה של אטרקציות, אלא תוכנית עם שעות, זמני נסיעה, ארוחות ופינות מנוחה.
כל הטקסט בעברית טבעית (שמות מקומות: השם שישראלים משתמשים בו, עם השם הלועזי בסוגריים אם עוזר).
חוקים:
- כבד את פרופיל המטיילים: מי נוסע (זוג/חברים/משפחה), תחומי עניין, מה שלא אוהבים, קצב, תקציב, מרחק נסיעה יומי מקסימלי.
- **התאם את האופי להרכב:** רק כשיש ילדים בפרופיל בנה סביבם (קצב, אטרקציות מתאימות-גיל). לזוג או חבורת חברים ללא ילדים — אל תשלב אטרקציות "לילדים"/משפחתיות אלא אם ביקשו במפורש; העדף את מה שמתאים למבוגרים לפי הטעם שלהם.
- מספר העצירות המשמעותיות ביום נקבע לפי הקצב שבפרופיל: "רגוע" 3-4, "בינוני" 4-5, "אינטנסיבי" 5-6. שלב תמיד מנוחה ואוכל.
- לכל יום כתוב שדה "why" קצר (משפט-שניים) שמסביר את ההיגיון: למה הסדר הזה, על מה דילגת ולמה. זה הערך המרכזי של האפליקציה.
- kind: nature/food/culture/rest/shopping. score=1-10 כמה האטרקציה מתאימה לקבוצה הזו (לפי הטעם וההרכב שלה). note=משפט קצר מעשי.
- בחר רק מהאטרקציות שסופקו. אל תמציא מקומות.`;

function attractionsBlock(attractions: Attraction[], isFamily = false): string {
  return attractions
    .map((a) =>
      JSON.stringify({
        name: a.name_he || a.name_en,
        en: a.name_en,
        category: a.category,
        sub: a.subcategory,
        indoor_outdoor: a.indoor_outdoor,
        season: a.best_season,
        // family_score is a family-friendliness score — only hint it to the model
        // for trips with kids, so adults-only plans aren't nudged toward it. The
        // editor's kids rating overrides it: "no" → drop the hint (keep it out of
        // family plans), "yes" → force a top score.
        ...(isFamily && a.editor_kids !== "no"
          ? { family_score: a.editor_kids === "yes" ? 10 : a.family_score }
          : {}),
        tip: a.tips_he,
      })
    )
    .join("\n");
}

async function callClaude(userText: string): Promise<Itinerary> {
  const resp = await client().messages.create({
    model: await getModel(),
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
  month?: number;
  profileText: string;
  attractions: Attraction[];
  hotels?: TripHotel[];
  insights?: Insight[];
  emphasis?: string;   // top taste tags in Hebrew — bias the plan (#63)
  // Two-tier build from the Explore selection (F1): anchors = the traveler's
  // chosen "כן"/must-sees (each is a day's centerpiece), fillers = "אם יש זמן".
  anchors?: Attraction[];
  fillers?: Attraction[];
  isFamily?: boolean;   // trip has kids → apply the family-friendliness lens
  walkPref?: number;    // 1-5 walk tolerance → tunes the geographic day hint
};

function emphasisBlock(e?: string): string {
  return e ? `\nהעדפות מודגשות של הקבוצה (תן להן משקל רב — בנה את הטיול סביבן): ${e}.\n` : "";
}

// The Explore selection turns the attraction list into two tiers: anchors the
// traveler explicitly chose (schedule all of them — each opens/anchors a day)
// and "אם יש זמן" fillers to place around them only if the pace allows.
function tieredBlock(anchors: Attraction[], fillers: Attraction[], isFamily: boolean): string {
  return `עוגני הטיול — המטייל בחר אותם במפורש. שבץ את כולם לאורך הימים, ופתח כל יום בעוגן (או שניים ליום ארוך). אלה לב הטיול:
${attractionsBlock(anchors, isFamily)}

"אם יש זמן" — פריטי מילוי אופציונליים. שבץ אותם סביב העוגנים רק אם הקצב מתיר, ובשדה note סמן אותם כ"אם יש זמן". אל תדחוס אותם על חשבון עוגן:
${fillers.length ? attractionsBlock(fillers, isFamily) : "(אין)"}`;
}

const MONTHS_HE = ["", "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
function seasonHint(month?: number): string {
  if (!month) return "";
  const he =
    [12, 1, 2].includes(month) ? "חורף"
    : [3, 4, 5].includes(month) ? "אביב"
    : [6, 7, 8].includes(month) ? "קיץ" : "סתיו";
  return `\nהטיול ב${MONTHS_HE[month]} (${he}). התאם את ההמלצות לעונה: העדף אטרקציות שמתאימות לעונה הזו (שדה season), הימנע ממקומות שמתאימים רק לעונה אחרת, וציין במידת הצורך מזג אוויר/לבוש. בחורף העדף אטרקציות מקורות; בקיץ אטרקציות מים/חוץ.\n`;
}

function hotelsBlock(hotels?: TripHotel[]): string {
  if (!hotels || hotels.length === 0) return "";
  const lines = hotels.map((h) => `- ${h.name} (${h.city}) [${h.lat},${h.lng}]`).join("\n");
  return `\nהמטיילים כבר הזמינו את המלונות הבאים — בנה טיול כוכב: כל יום סובב סביב בסיס הלינה, עם טיולי-יום לאטרקציות בטווח הנסיעה היומי. סדר את הימים כדי למזער נסיעה:\n${lines}\n`;
}

export async function generateItinerary(p: GenerateParams): Promise<Itinerary> {
  const isFamily = p.isFamily === true;
  const clusterPool = p.anchors && p.anchors.length
    ? [...p.anchors, ...(p.fillers ?? [])] : p.attractions;
  const attractionsSection = p.anchors && p.anchors.length
    ? tieredBlock(p.anchors, p.fillers ?? [], isFamily)
    : `אטרקציות זמינות (בחר מתוכן בלבד):\n${attractionsBlock(p.attractions, isFamily)}`;
  const userText = `בנה לו"ז טיול ל${p.city}, ${p.country}.
מספר ימים: ${p.days}
פרופיל המטיילים: ${p.profileText}
${emphasisBlock(p.emphasis)}${seasonHint(p.month)}${hotelsBlock(p.hotels)}${verifiedBlock(p.insights, p.attractions)}${proximityBlock(clusterPool, p.days, p.walkPref)}
${attractionsSection}`;
  return callClaude(userText);
}

export type MultiSegment = {
  city: string;
  country: string;
  days: number;
  attractions: Attraction[];
  hotels?: TripHotel[];
  insights?: Insight[];
};

// One continuous itinerary across several base cities (a multi-city trip).
export async function generateMultiItinerary(p: {
  segments: MultiSegment[];
  month?: number;
  profileText: string;
  emphasis?: string;
  isFamily?: boolean;
}): Promise<Itinerary> {
  const isFamily = p.isFamily === true;
  const total = p.segments.reduce((a, s) => a + s.days, 0);
  const order = p.segments.map((s, i) => `${i + 1}) ${s.city} (${s.days} ימים)`).join(" ← ");
  const segBlocks = p.segments
    .map((s, i) => {
      const base = s.hotels && s.hotels.length
        ? `בסיס הלינה במקטע זה: ${s.hotels.map((h) => `${h.name} (${h.city}) [${h.lat},${h.lng}]`).join(", ")}. סדר את ימי המקטע כדי למזער נסיעה מהבסיס.\n`
        : "";
      return `### מקטע ${i + 1}: ${s.city}, ${s.country} — ${s.days} ימים\n` +
        base +
        verifiedBlock(s.insights, s.attractions) +
        `אטרקציות זמינות במקטע זה (לימי מקטע זה בלבד):\n${attractionsBlock(s.attractions, isFamily)}`;
    })
    .join("\n\n");
  const userText = `בנה לו"ז לטיול רב-ערים אחד ורציף של ${total} ימים, העובר בין האזורים לפי הסדר: ${order}.
פרופיל המטיילים: ${p.profileText}
${emphasisBlock(p.emphasis)}${seasonHint(p.month)}
כללים למקטעים:
- מספר את הימים ברצף 1..${total} (אל תתחיל ספירה מחדש בכל עיר). שדה base של כל יום = שם העיר/אזור של המקטע שאליו הוא שייך.
- הקצה לכל מקטע בדיוק את מספר הימים שצוין, לפי הסדר.
- ביום המעבר בין מקטע למקטע ציין במפורש את הנסיעה בין הערים (ב-note וב-why) והשאר אותו קליל — אל תעמיס אטרקציות ביום נסיעה.
- לכל יום בחר אטרקציות אך ורק מרשימת האטרקציות של אותו מקטע.

${segBlocks}`;
  return callClaude(userText);
}

export async function reviseItinerary(
  current: Itinerary,
  instruction: string,
  attractions: Attraction[],
  profileText?: string,
  dateContext?: string
): Promise<Itinerary> {
  const userText = `זהו הלו"ז הנוכחי:
${JSON.stringify(current, null, 1)}
${profileText ? `\nפרופיל המטיילים: ${profileText}\n` : ""}${dateContext ? `\nהקשר תאריכים:\n${dateContext}\n` : ""}
בקשת המשתמש לשינוי: "${instruction}"

ארגן מחדש את הלו"ז לפי הבקשה. אם הבקשה מתייחסת ליום ספציפי — שנה אך ורק את אותו יום והשאר את כל שאר הימים בדיוק כפי שהם. שמור על מה שעובד, שנה רק מה שצריך, ועדכן את שדה ה-"why" של הימים שהשתנו כדי להסביר את השינוי. אל תשנה את מספר הימים אלא אם התבקשת במפורש.
אם רלוונטי, בחר אטרקציות חלופיות מהרשימה:
${attractionsBlock(attractions)}`;
  return callClaude(userText);
}

// --- Destination recommender (#7): "I don't know where to go" ---
const RECO_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          city: { type: "string" },        // must be one of the provided cities (English)
          reason: { type: "string" },       // Hebrew — why it fits THIS family
          highlights: { type: "string" },   // Hebrew — 2-4 keywords
        },
        required: ["city", "reason", "highlights"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
};

export type DestinationReco = { city: string; reason: string; highlights: string };

function summariesBlock(s: DestinationSummary[]): string {
  return s
    .map((d) => JSON.stringify({
      city: d.city, country: d.country, total: d.total, must_see: d.must_see,
      museum: d.museum, historic: d.historic, nature: d.nature, food: d.food,
      shopping: d.shopping, water_park: d.water_park, theme_park: d.theme_park, zoo: d.zoo,
    }))
    .join("\n");
}

export async function recommendDestinations(p: {
  profileText: string;
  month?: number;
  summaries: DestinationSummary[];
}): Promise<DestinationReco[]> {
  const userText = `מטיילים מתלבטים לאן לטוס — הם יודעים מי נוסע ומה מעדיפים, אבל לא לאן.
המלץ על 3 יעדים מתוך הרשימה בלבד, מהמתאים ביותר ולמטה.
פרופיל המטיילים: ${p.profileText}
${seasonHint(p.month)}
לכל המלצה: "reason" = משפט-שניים בעברית למה היעד מתאים *לקבוצה הזו* (קשר להעדפות, להרכב ולעונה); "highlights" = 2-4 מילות מפתח (למשל "מוזיאונים, פארקי מים, היסטוריה"). שדה "city" חייב להיות בדיוק אחד מהשמות (באנגלית) שברשימה.
היעדים האפשריים (המספרים = כמה אטרקציות מכל סוג במאגר):
${summariesBlock(p.summaries)}`;

  const resp = await client().messages.create({
    model: await getModel(),
    max_tokens: 2000,
    system: "אתה יועץ טיולים למטיילים ישראלים. ענה בעברית טבעית, התאם להעדפות ולעונה, ואל תמליץ על יעד שאינו ברשימה שסופקה.",
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: RECO_SCHEMA } },
    messages: [{ role: "user", content: userText }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no text block");
  return (JSON.parse(block.text).recommendations ?? []) as DestinationReco[];
}
