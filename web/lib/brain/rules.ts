// The Brain's TECHNIQUE vocabulary — the bridge between the editor and the engine.
// Every principle is a TYPED rule: a `kind` from this fixed catalog + `params`. The
// editor edits params with dropdowns and reads `principleLabel()` (a Hebrew
// sentence); the Brain reads `resolveBrainRules()` (typed values) and never parses
// free text. Adding a new technique = add a kind here + honour it in the builder/
// critic. See docs/logic/brain.md, brain_principles table (supabase/phase16.sql).
import { AUDIENCE_PREFS, PACE_STOPS, WEIGHTS, QUALITY_BAR, THRESHOLDS, DAY_WALK, type Audience } from "./policy";
import { DWELL_DEFAULT, type DwellCfg } from "./traits";

export type Principle = {
  id: number; kind: string; params: Record<string, unknown>;
  scope: "global" | "city"; destination_id: number | null; audience: Audience | null;
  enabled: boolean; source_note_id: number | null; city?: string | null;
};

// Hebrew labels for the experience-types a rule can target.
export const TYPE_HE: Record<string, string> = {
  museum: "מוזיאונים", historic: "אתרים היסטוריים", memorial: "אנדרטאות",
  heavy_history: "היסטוריה כבדה (שואה/נאצים)", active: "אטרקציות פעילות",
  cultural: "אתרי תרבות", culture: "אתרי תרבות", attraction: "אטרקציות", nature: "טבע",
  viewpoint: "תצפיות", food: "אוכל", shopping: "קניות", market: "שווקים", nightlife: "חיי לילה",
  bar: "ברים", romantic: "רומנטי", social: "חברתי", outdoors: "טבע/חוץ",
};
const th = (t: unknown) => TYPE_HE[String(t)] ?? String(t);
const AUD_HE: Record<string, string> = { families: "עם ילדים", adults: "בלי ילדים" };
const ah = (a: unknown) => (a ? AUD_HE[String(a)] ?? String(a) : "כל הקהלים");

// Critic quality dimensions (for the dimension_weight rule).
export const DIM_HE: Record<string, string> = {
  walkability: "הליכתיות", mustSee: "כיסוי חובה", audienceFit: "התאמת קהל", variety: "גיוון",
  pace: "קצב", balance: "איזון", coherence: "קוהרנטיות",
};
const dh = (d: unknown) => DIM_HE[String(d)] ?? String(d);

export type ParamField = { key: string; type: "audience" | "exptype" | "number" | "text" | "time" | "dimension"; label: string };

// The catalog. `he` renders the readable sentence; `help` is a full plain-Hebrew
// explanation of what the value DOES (shown under each row so no value is cryptic);
// `params` drives the editor form; `applies` is a dev hint.
export const RULE_KINDS: Record<string, { title: string; help: string; he: (p: Record<string, unknown>) => string; params: ParamField[]; applies: string }> = {
  pace_stops: {
    title: "קצב (עצירות ליום)",
    help: "כמה עצירות משמעותיות לתכנן ליום עבור הקהל הזה — לא כולל אוכל והפסקות. יותר = יום עמוס יותר; פחות = יום רגוע עם אוויר לספונטניות.",
    he: (p) => `קצב ${ah(p.audience)}: כ-${p.stops} עצירות ביום`,
    params: [{ key: "audience", type: "audience", label: "קהל" }, { key: "stops", type: "number", label: "עצירות" }],
    applies: "builder — per-day budget",
  },
  max_type_per_day: {
    title: "מקסימום מסוג ביום",
    help: "מגביל כמה עצירות מאותו סוג ייכנסו ליום אחד, כדי שהיום לא יהיה חד-גוני. למשל 'מקסימום 2 מוזיאונים' — מונע יום של מבצר+כנסייה+מוזיאון שמרגיש משעמם.",
    he: (p) => `מקסימום ${p.max} ${th(p.type)} ביום`,
    params: [{ key: "type", type: "exptype", label: "סוג" }, { key: "max", type: "number", label: "מקסימום" }],
    applies: "critic flag + builder ordering",
  },
  active_anchor_required: {
    title: "אנקר פעיל חובה",
    help: "מוודא שכל יום עבור הקהל הזה כולל לפחות אטרקציה פעילה אחת (רכבל, מזחלות, קניון, בריכה, פארק) — ולא רק אתרים 'פסיביים' כמו מוזיאונים וכנסיות. אם אין — המוח מסמן את היום כחלש.",
    he: (p) => `כל יום ל${ah(p.audience)} חייב אטרקציה פעילה אחת (רכבל/מזחלות/קניון/בריכה)`,
    params: [{ key: "audience", type: "audience", label: "קהל" }],
    applies: "critic flag",
  },
  day_ender_last: {
    title: "מסיים-יום בסוף",
    help: "אטרקציות מתישות (פארק-מים, פארק-שעשועים, הרפתקה) יסודרו תמיד בסוף היום — כי אחריהן כולם עייפים ולא רוצים עוד עצירה. משנה רק את הסדר בתוך היום, לא את התוכן.",
    he: () => "אטרקציות מים/הרפתקה/פארק — לסוף היום (אחריהן כולם עייפים)",
    params: [],
    applies: "builder ordering",
  },
  season_filter: {
    title: "סינון עונתי",
    help: "מסנן אתרים שלא מתאימים לעונת הטיול (לפי חודש הנסיעה): זירת-קרח/סקי לא יופיעו בטיול-קיץ, ופארקי-מים/בריכות לא בטיול-חורף.",
    he: () => "התאם לעונה — סנן אתרי חורף (קרח/סקי) בקיץ ואתרי קיץ (מים) בחורף",
    params: [],
    applies: "pool filter by trip month",
  },
  avoid_category: {
    title: "הימנעות מסוג",
    help: "מוציא לגמרי סוג אתרים מהטיול של הקהל הזה. למשל: היסטוריה-כבדה (מוזיאוני שואה/נאצים) בטיולי משפחה, או חיי-לילה בטיול עם ילדים.",
    he: (p) => `${ah(p.audience)}: הימנע מ${th(p.category)}`,
    params: [{ key: "audience", type: "audience", label: "קהל" }, { key: "category", type: "exptype", label: "סוג" }],
    applies: "pool filter for that audience",
  },
  day_window: {
    title: "שעת התחלת יום",
    help: "השעה שבה מתחיל היום — כלומר מתי מגיעים לעצירה הראשונה. זהו בסיס כל לוח-הזמנים: כל שעות ההגעה נספרות מכאן קדימה לפי משך-השהייה וזמני-המעבר.",
    he: (p) => `היום מתחיל בשעה ${p.start || "09:30"}`,
    params: [{ key: "start", type: "time", label: "שעה" }],
    applies: "scheduler — day start clock",
  },
  lunch: {
    title: "הפסקת צהריים",
    help: "מתי לשלב הפסקת אוכל וכמה זמן. ההפסקה נכנסת בעצירה הראשונה שאחרי השעה שנקבעה (למשל 12:00), ותופסת את מספר הדקות שנקבע — כך שאר היום נדחף בהתאם.",
    he: (p) => `הפסקת צהריים בעצירה הראשונה אחרי ${p.after || "12:00"}, למשך ${p.minutes || 60} דק׳`,
    params: [{ key: "after", type: "time", label: "לא לפני" }, { key: "minutes", type: "number", label: "משך (דק׳)" }],
    applies: "scheduler — lunch insertion",
  },
  visit_minutes: {
    title: "משך ביקור לפי אופי המקום",
    help: "כמה זמן שוהים בכל עצירה — לפי סוג המקום, לא לפי נתון OSM הלא-אמין. 'עוברים ומסתכלים' (גשר, תצפית, כיכר, אנדרטה) לוקח דקות ספורות; מקום 'רגיל' (כנסייה, גן) כחצי שעה; 'עומק' (מוזיאון, ארמון, גן-חיות) שעה-שעתיים; 'שוק' הוא עוגן של חצי יום. ערכים אלה קובעים כמה עצירות נכנסות ליום ואיך נראים הזמנים.",
    he: (p) => `שהייה: עוברים ${p.passby || 20} · רגיל ${p.standard || 50} · עומק ${p.deep || 110} · שוק ${p.market || 150} (דק׳)`,
    params: [
      { key: "passby", type: "number", label: "עוברים ומסתכלים" },
      { key: "standard", type: "number", label: "רגיל" },
      { key: "deep", type: "number", label: "עומק (מוזיאון/ארמון)" },
      { key: "market", type: "number", label: "שוק" },
    ],
    applies: "scheduler + clusterer — dwell minutes per stop type",
  },
  daytrip_threshold: {
    title: "סף יום-טיול (ק״מ)",
    help: "מעל כמה ק״מ מהעיר מקום נחשב ל'יום-טיול ברכב' במקום עצירה בתוך העיר. מתחת לסף — נכנס ליום-הליכה בעיר; מעליו — לאשכול טיול-רכב נפרד. רלוונטי רק לערי-בסיס (car_base).",
    he: (p) => `מעל ${p.km || 18} ק״מ מהעיר = יום טיול-רכב (מתחת = בתוך העיר)`,
    params: [{ key: "km", type: "number", label: "ק״מ" }],
    applies: "daytrips splitByReach",
  },
  daytrip_budget: {
    title: "תדירות ימי-רכב",
    help: "כמה ימי טיול-רכב לשלב מתוך אורך הטיול — יום-רכב אחד לכל N ימים. ערך 2 = בערך חצי מהימים בחוץ ברכב; ערך 3 = שליש. תמיד נשאר לפחות יום-עיר אחד.",
    he: (p) => `יום טיול-רכב אחד לכל ${p.perDays || 2} ימי-טיול`,
    params: [{ key: "perDays", type: "number", label: "לכל N ימים" }],
    applies: "daytrips dayTripBudget",
  },
  daytrip_max_stops: {
    title: "מקסימום עצירות ביום-רכב",
    help: "כמה עצירות לכל היותר ביום טיול-רכב אחד. יום בחוץ בנוי מאנקר מרכזי (נקיק/אגם/מערה) + כמה עצירות סמוכות באותו אזור — זו התקרה.",
    he: (p) => `מקסימום ${p.max || 5} עצירות ביום טיול-רכב`,
    params: [{ key: "max", type: "number", label: "מקסימום" }],
    applies: "daytrips clusterDayTrips",
  },
  free_gems: {
    title: "פינות-חמד",
    help: "כמה 'פינות-חמד' קטנות להוסיף לכל יום — מקומות סמוכים שנמצאים כבר על הדרך. מוסיף עד X מקומות ליום, כל עוד הם בעיקוף של עד Y דקות מהמסלול הקיים. יותר = יום מלא ומגוון יותר בלי נסיעות מיותרות.",
    he: (p) => `הוסף עד ${p.maxPerDay || 3} פינות-חמד ליום (עד ${p.detourMin || 4} דק׳ עיקוף)`,
    params: [{ key: "maxPerDay", type: "number", label: "מקס׳ ליום" }, { key: "detourMin", type: "number", label: "עיקוף (דק׳)" }],
    applies: "cluster free-gem pass",
  },
  same_place_km: {
    title: "מרחק \"אותו מקום\"",
    help: "המרחק (במטרים) שמתחתיו שתי עצירות נחשבות לאותו מקום ולא יופיעו פעמיים באותו יום — למשל מבצר והגבעה שהוא יושב עליה, או אגם והמזח שלו. מונע כפילות; המוח שומר את בעל-הערך מבין השניים.",
    he: (p) => `שתי עצירות במרחק פחות מ-${p.meters || 90} מ׳ = אותו מקום`,
    params: [{ key: "meters", type: "number", label: "מטרים" }],
    applies: "cluster dropSamePlace",
  },
  quality_bar: {
    title: "סף איכות",
    help: "מתחת לאיזה ציון (0-100) טיול מסומן 'דורש שיפור' בבדיקה-העצמית. משפיע רק על הסימון/התראה בבדיקה, לא על התוכן שנבנה.",
    he: (p) => `טיול מתחת לציון ${p.score || 70} מסומן 'דורש שיפור'`,
    params: [{ key: "score", type: "number", label: "ציון" }],
    applies: "critic needsWork",
  },
  dimension_weight: {
    title: "משקל מימד בציון",
    help: "כמה כל מימד-איכות שוקל בציון הכולל של הטיול (הליכתיות, כיסוי-חובה, התאמת-קהל, גיוון, קצב, איזון, קוהרנטיות). משקל גבוה = המימד חשוב יותר בהגדרת 'טיול טוב'.",
    he: (p) => `משקל ${dh(p.dimension)} בציון: ${p.weight ?? "?"}`,
    params: [{ key: "dimension", type: "dimension", label: "מימד" }, { key: "weight", type: "number", label: "משקל" }],
    applies: "critic score weights",
  },
  min_must_see: {
    title: "מינימום אתרי-חובה",
    help: "כמה אתרי-חובה (must-see) טיול חייב לכלול לכל הפחות. מתחת לזה — המוח מסמן בעיה קריטית בבדיקה.",
    he: (p) => `טיול חייב לפחות ${p.count || 3} אתרי-חובה`,
    params: [{ key: "count", type: "number", label: "מספר" }],
    applies: "critic mustSee",
  },
  min_audience_fit: {
    title: "סף התאמת-קהל",
    help: "מתחת לאיזה ציון-התאמה (0-100) עצירה נחשבת 'בהתאמה חלשה' לקהל. אם רוב העצירות ביום מתחת לסף — המוח מסמן שהיום לא ממש מתאים לקהל.",
    he: (p) => `עצירה מתחת ל-${p.score || 45} התאמה = חלשה לקהל`,
    params: [{ key: "score", type: "number", label: "ציון" }],
    applies: "critic audienceFit",
  },
  max_same_type_run: {
    title: "מקס׳ רצף מאותו סוג",
    help: "כמה עצירות מאותו סוג-חוויה מותרות ברצף באותו יום לפני שזה מרגיש מונוטוני. שונה מ'מקסימום מסוג ביום' — כאן מדובר ברצף עוקב, לא בסך-הכל ליום.",
    he: (p) => `מקסימום ${p.max || 3} עצירות מאותו סוג-חוויה ברצף`,
    params: [{ key: "max", type: "number", label: "מקסימום" }],
    applies: "critic variety",
  },
  day_walk_band: {
    title: "רצועת-הליכה נוחה ליום",
    help: "כמה דקות הליכה ביום נחשבות נוחות (אידאלי), ומעל כמה זה כבר 'יותר מדי' (דגל). משפיע על ציון ההליכתיות ועל האזהרה 'יום ארוך מדי ברגל'.",
    he: (p) => `הליכה ליום: ~${p.ideal || 45} דק׳ אידאלי · מעל ${p.flag || 95} דק׳ = יותר מדי`,
    params: [{ key: "ideal", type: "number", label: "אידאלי" }, { key: "flag", type: "number", label: "דגל" }],
    applies: "critic walkability",
  },
  custom: {
    title: "הערה חופשית (מייעצת)",
    help: "טקסט חופשי שאינו נאכף אוטומטית ע״י המוח — הנחיה שאני (Claude Code) מעכל ידנית לקוד/למתכון. שקוף ומתועד, אבל לא כלל שרץ מעצמו.",
    he: (p) => String(p.text ?? "הערה"),
    params: [{ key: "text", type: "text", label: "טקסט" }],
    applies: "advisory — not auto-applied; digested manually",
  },
};

// "HH:MM" → minutes past midnight (for the scheduler); tolerant of bad input.
export function timeToMin(s: unknown, fallback: number): number {
  const m = String(s ?? "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? Math.min(1439, Math.max(0, +m[1] * 60 + +m[2])) : fallback;
}

export function principleLabel(kind: string, params: Record<string, unknown>): string {
  return RULE_KINDS[kind]?.he(params) ?? kind;
}

// The 3 tiers (+ audience/filter base + free notes) — the clear layer split shown in
// the admin. Each kind belongs to exactly one group.
export const GROUP_ORDER = ["קהל וסינון", "תחושת-יום", "מבנה-הטיול", "כיול-הביקורת", "הערות"] as const;
export const KIND_GROUP: Record<string, (typeof GROUP_ORDER)[number]> = {
  pace_stops: "קהל וסינון", max_type_per_day: "קהל וסינון", active_anchor_required: "קהל וסינון",
  day_ender_last: "קהל וסינון", season_filter: "קהל וסינון", avoid_category: "קהל וסינון",
  day_window: "תחושת-יום", lunch: "תחושת-יום", visit_minutes: "תחושת-יום",
  daytrip_threshold: "מבנה-הטיול", daytrip_budget: "מבנה-הטיול", daytrip_max_stops: "מבנה-הטיול",
  free_gems: "מבנה-הטיול", same_place_km: "מבנה-הטיול",
  quality_bar: "כיול-הביקורת", dimension_weight: "כיול-הביקורת", min_must_see: "כיול-הביקורת",
  min_audience_fit: "כיול-הביקורת", max_same_type_run: "כיול-הביקורת", day_walk_band: "כיול-הביקורת",
  custom: "הערות",
};
export const GROUP_HELP: Record<string, string> = {
  "קהל וסינון": "למי הטיול ומה נכנס אליו — קצב, אנקרים, סינון עונתי/סוגים.",
  "תחושת-יום": "איך מרגיש היום — שעות, הפסקות, משך-שהייה.",
  "מבנה-הטיול": "מבנה גדול — ימי טיול-רכב, פינות-חמד, מניעת כפילות.",
  "כיול-הביקורת": "איך המוח מנקד 'טיול טוב' בבדיקה-העצמית (מתקדם).",
  "הערות": "הנחיות חופשיות שאני מעכל ידנית — לא נאכפות אוטומטית.",
};

// The engine-facing resolved config. The builder/critic read THIS, not the DB rows.
export type BrainRules = {
  paceStops: Record<Audience, number>;
  maxTypePerDay: { type: string; max: number }[];
  activeAnchorAudiences: Audience[];
  dayEnderLast: boolean;
  seasonFilter: boolean;
  avoid: Record<Audience, string[]>;
  // Tier-1 schedule feel (all in minutes; from day_window / lunch / visit_default).
  dayStartMin: number;
  lunchAfterMin: number;
  lunchMinutes: number;
  dwell: DwellCfg;   // visit_minutes technique — dwell per stop bucket
  // Tier-2 structure (from daytrip_* / free_gems / same_place_km).
  daytripThresholdKm: number;
  daytripPerDays: number;
  daytripMaxStops: number;
  samePlaceMeters: number;
  freeGemMaxPerDay: number;
  freeGemDetourMin: number;
  // Tier-3 critic calibration (from quality_bar / dimension_weight / min_* / day_walk_band).
  weights: Record<string, number>;
  qualityBar: number;
  minMustSee: number;
  minAudienceFit: number;
  maxSameTypeRun: number;
  dayWalkIdeal: number;
  dayWalkFlag: number;
};

const AUDS: Audience[] = ["families", "adults"];

// Merge policy defaults with the enabled principles that apply to this destination.
// Empty table → behaves exactly like the hard-coded policy (safe fallback).
export function resolveBrainRules(principles: Principle[], destId?: number | null): BrainRules {
  // On/off techniques default OFF and are switched ON by an enabled principle — so
  // toggling the principle off in the editor actually turns the behaviour off.
  const rules: BrainRules = {
    paceStops: { ...PACE_STOPS },
    maxTypePerDay: [],
    activeAnchorAudiences: [],
    dayEnderLast: false,
    seasonFilter: false,
    avoid: { families: [...AUDIENCE_PREFS.families.avoid], adults: [...AUDIENCE_PREFS.adults.avoid] },
    dayStartMin: 9 * 60 + 30, lunchAfterMin: 12 * 60, lunchMinutes: 60, dwell: { ...DWELL_DEFAULT },
    daytripThresholdKm: 18, daytripPerDays: 2, daytripMaxStops: 5, samePlaceMeters: 90, freeGemMaxPerDay: 3, freeGemDetourMin: 4,
    weights: { ...WEIGHTS }, qualityBar: QUALITY_BAR, minMustSee: THRESHOLDS.minMustSeePerTrip,
    minAudienceFit: THRESHOLDS.minAudienceFit, maxSameTypeRun: THRESHOLDS.maxSameTypeRun,
    dayWalkIdeal: DAY_WALK.ideal, dayWalkFlag: DAY_WALK.flag,
  };
  const active = principles.filter((p) => p.enabled && (p.scope === "global" || (p.scope === "city" && p.destination_id === destId)));
  // global first, then city (city overrides/adds on top).
  active.sort((a, b) => (a.scope === "city" ? 1 : 0) - (b.scope === "city" ? 1 : 0));
  for (const p of active) {
    const q = p.params || {};
    switch (p.kind) {
      case "pace_stops":
        if (q.audience && q.stops != null) rules.paceStops[q.audience as Audience] = Number(q.stops);
        break;
      case "max_type_per_day":
        if (q.type && q.max != null) rules.maxTypePerDay.push({ type: String(q.type), max: Number(q.max) });
        break;
      case "active_anchor_required": {
        const auds = q.audience ? [q.audience as Audience] : AUDS;
        for (const a of auds) if (!rules.activeAnchorAudiences.includes(a)) rules.activeAnchorAudiences.push(a);
        break;
      }
      case "day_ender_last": rules.dayEnderLast = true; break;
      case "season_filter": rules.seasonFilter = true; break;
      case "avoid_category": {
        const auds = q.audience ? [q.audience as Audience] : AUDS;
        for (const a of auds) if (q.category && !rules.avoid[a].includes(String(q.category))) rules.avoid[a].push(String(q.category));
        break;
      }
      case "day_window": rules.dayStartMin = timeToMin(q.start, rules.dayStartMin); break;
      case "lunch":
        rules.lunchAfterMin = timeToMin(q.after, rules.lunchAfterMin);
        if (q.minutes != null) rules.lunchMinutes = Number(q.minutes);
        break;
      case "visit_minutes":
        for (const k of ["passby", "standard", "deep", "market"] as const)
          if (q[k] != null) rules.dwell[k] = Number(q[k]);
        break;
      case "daytrip_threshold": if (q.km != null) rules.daytripThresholdKm = Number(q.km); break;
      case "daytrip_budget": if (q.perDays != null) rules.daytripPerDays = Number(q.perDays); break;
      case "daytrip_max_stops": if (q.max != null) rules.daytripMaxStops = Number(q.max); break;
      case "free_gems":
        if (q.maxPerDay != null) rules.freeGemMaxPerDay = Number(q.maxPerDay);
        if (q.detourMin != null) rules.freeGemDetourMin = Number(q.detourMin);
        break;
      case "same_place_km": if (q.meters != null) rules.samePlaceMeters = Number(q.meters); break;
      case "quality_bar": if (q.score != null) rules.qualityBar = Number(q.score); break;
      case "dimension_weight": if (q.dimension && q.weight != null) rules.weights[String(q.dimension)] = Number(q.weight); break;
      case "min_must_see": if (q.count != null) rules.minMustSee = Number(q.count); break;
      case "min_audience_fit": if (q.score != null) rules.minAudienceFit = Number(q.score); break;
      case "max_same_type_run": if (q.max != null) rules.maxSameTypeRun = Number(q.max); break;
      case "day_walk_band":
        if (q.ideal != null) rules.dayWalkIdeal = Number(q.ideal);
        if (q.flag != null) rules.dayWalkFlag = Number(q.flag);
        break;
    }
  }
  return rules;
}
