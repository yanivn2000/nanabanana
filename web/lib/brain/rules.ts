// The Brain's TECHNIQUE vocabulary — the bridge between the editor and the engine.
// Every principle is a TYPED rule: a `kind` from this fixed catalog + `params`. The
// editor edits params with dropdowns and reads `principleLabel()` (a Hebrew
// sentence); the Brain reads `resolveBrainRules()` (typed values) and never parses
// free text. Adding a new technique = add a kind here + honour it in the builder/
// critic. See docs/logic/brain.md, brain_principles table (supabase/phase16.sql).
import { AUDIENCE_PREFS, PACE_STOPS, type Audience } from "./policy";

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

export type ParamField = { key: string; type: "audience" | "exptype" | "number" | "text"; label: string };

// The catalog. `he` renders the readable sentence; `params` drives the editor form;
// `applies` is a hint to editors/devs of where the Brain honours it.
export const RULE_KINDS: Record<string, { title: string; he: (p: Record<string, unknown>) => string; params: ParamField[]; applies: string }> = {
  pace_stops: {
    title: "קצב (עצירות ליום)",
    he: (p) => `קצב ${ah(p.audience)}: כ-${p.stops} עצירות ביום`,
    params: [{ key: "audience", type: "audience", label: "קהל" }, { key: "stops", type: "number", label: "עצירות" }],
    applies: "builder — per-day budget",
  },
  max_type_per_day: {
    title: "מקסימום מסוג ביום",
    he: (p) => `מקסימום ${p.max} ${th(p.type)} ביום`,
    params: [{ key: "type", type: "exptype", label: "סוג" }, { key: "max", type: "number", label: "מקסימום" }],
    applies: "critic flag + builder ordering",
  },
  active_anchor_required: {
    title: "אנקר פעיל חובה",
    he: (p) => `כל יום ל${ah(p.audience)} חייב אטרקציה פעילה אחת (רכבל/מזחלות/קניון/בריכה)`,
    params: [{ key: "audience", type: "audience", label: "קהל" }],
    applies: "critic flag",
  },
  day_ender_last: {
    title: "מסיים-יום בסוף",
    he: () => "אטרקציות מים/הרפתקה/פארק — לסוף היום (אחריהן כולם עייפים)",
    params: [],
    applies: "builder ordering",
  },
  season_filter: {
    title: "סינון עונתי",
    he: () => "התאם לעונה — סנן אתרי חורף (קרח/סקי) בקיץ ואתרי קיץ (מים) בחורף",
    params: [],
    applies: "pool filter by trip month",
  },
  avoid_category: {
    title: "הימנעות מסוג",
    he: (p) => `${ah(p.audience)}: הימנע מ${th(p.category)}`,
    params: [{ key: "audience", type: "audience", label: "קהל" }, { key: "category", type: "exptype", label: "סוג" }],
    applies: "pool filter for that audience",
  },
  custom: {
    title: "הערה חופשית (מייעצת)",
    he: (p) => String(p.text ?? "הערה"),
    params: [{ key: "text", type: "text", label: "טקסט" }],
    applies: "advisory — not auto-applied; digested manually",
  },
};

export function principleLabel(kind: string, params: Record<string, unknown>): string {
  return RULE_KINDS[kind]?.he(params) ?? kind;
}

// The engine-facing resolved config. The builder/critic read THIS, not the DB rows.
export type BrainRules = {
  paceStops: Record<Audience, number>;
  maxTypePerDay: { type: string; max: number }[];
  activeAnchorAudiences: Audience[];
  dayEnderLast: boolean;
  seasonFilter: boolean;
  avoid: Record<Audience, string[]>;
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
    }
  }
  return rules;
}
