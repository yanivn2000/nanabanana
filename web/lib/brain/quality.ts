// The Brain's QUALITY CHECK (deterministic, no AI). Two lenses, per the editor:
//   1) conformance — does the built trip obey the enabled techniques/values?
//   2) fun — does it *sound enjoyable*? A trip can pass every setting and still be a
//      flat, museum-heavy, anticlimactic day. These are heuristic "fun signals".
// The output is structured findings; the route formats them into free text the editor
// pastes into chat, where Claude Code adds the deep (real-AI) judgment + fixes.
import type { Attraction } from "../db";
import { audienceFitScore, type Audience } from "./policy";
import type { BrainRules } from "./rules";
import { isActiveAnchor, isSoftFun, stopMatchesType } from "./traits";

const expType = (a: Attraction) => a.audience_fit?.type || a.category;
const nameOf = (a: Attraction) => a.name_he || a.name_en;
const isHighlight = (a: Attraction, aud: Audience) => a.must_see === 1 || audienceFitScore(a.audience_fit, aud) >= 70;
const isObscure = (a: Attraction) => a.must_see !== 1 && !a.image_url &&
  audienceFitScore(a.audience_fit, "families") < 40 && audienceFitScore(a.audience_fit, "adults") < 40;
// A day "feels alive" if it has at least one engaging ANCHOR. Data-driven on purpose:
// a keyword list can't know which museum kids love (the dinosaur hall, the hands-on
// kids' museum) and which is a dull gallery — but must-see / audience_fit can. So an
// anchor is: an active/experiential place (aquarium, salt mine, cable-car…), a park or
// headline attraction (isSoftFun), OR a genuine highlight for THIS audience.
const isEngaging = (a: Attraction, aud: Audience) => isActiveAnchor(a) || isSoftFun(a) || isHighlight(a, aud);

export type QualityFinding = { ok: boolean; msg: string };
export type Quality = { conformance: QualityFinding[]; fun: string[]; suggestions: string[] };

export function qualityCheck(days: Attraction[][], audience: Audience, rules: BrainRules, ctx: { cityMustCount: number }): Quality {
  const conformance: QualityFinding[] = [];
  const fun: string[] = [];
  const suggestions = new Set<string>();
  const flat = days.flat();

  // ---- 1) CONFORMANCE — trip vs the enabled techniques -----------------------
  for (const cap of rules.maxTypePerDay) {
    const bad = days.map((d, i) => ({ n: d.filter((a) => stopMatchesType(a, cap.type)).length, i }))
      .filter((x) => x.n > cap.max).map((x) => `יום ${x.i + 1} (${x.n})`);
    conformance.push(bad.length
      ? { ok: false, msg: `חריגה ממקסימום ${cap.max} ${cap.type} ליום: ${bad.join(", ")}` }
      : { ok: true, msg: `≤${cap.max} ${cap.type} ליום` });
  }
  // NB: "does a family day have an active anchor" is NOT a conformance check — it's a
  // taste/fun question (change ב׳), so it lives in the FUN lens below, as a soft flag
  // gated on the day being genuinely flat. Conformance = only settings the trip can
  // objectively obey/violate.
  const must = flat.filter((a) => a.must_see === 1).length;
  conformance.push(must >= rules.minMustSee
    ? { ok: true, msg: `${must} אתרי-חובה (סף ${rules.minMustSee})` }
    : { ok: false, msg: `רק ${must} אתרי-חובה — מתחת לסף ${rules.minMustSee}` });
  const weakFit = flat.filter((a) => audienceFitScore(a.audience_fit, audience) < rules.minAudienceFit).length;
  if (flat.length && weakFit > flat.length / 2)
    conformance.push({ ok: false, msg: `רוב העצירות (${weakFit}/${flat.length}) בהתאמה נמוכה ל${audience === "families" ? "משפחות" : "מבוגרים"}` });

  // ---- 2) FUN — does it sound enjoyable? -------------------------------------
  const types = new Set(flat.map(expType));
  if (flat.length && types.size < Math.max(3, days.length + 1)) {
    fun.push(`גיוון-חוויה נמוך — רק ${types.size} סוגי-חוויה בכל הטיול. עלול להרגיש חד-גוני.`);
    suggestions.add("להחמיר max_type_per_day או להזרים יותר סוגי-חוויה (טבע/אוכל/פעילות) לימים.");
  }
  const needsAnchor = rules.activeAnchorAudiences.includes(audience);
  days.forEach((d, i) => {
    // Flat-day flag — fires ONLY when a 3+ stop day has NO engaging anchor at all
    // (no active/experiential place, no park/headline attraction, no audience
    // highlight). A day built around Notre-Dame or a dinosaur hall never trips it;
    // a fortress→cathedral→museum→museum slog does. Wording depends on the audience
    // (families need the "fun" nudge more).
    if (d.length >= 3 && !d.some((a) => isEngaging(a, audience)))
      fun.push(needsAnchor
        ? `יום ${i + 1}: אין עוגן פעיל/חוויתי — כל היום תרבות פסיבית ועצירות משניות, עלול להרגיש שטוח לילדים.`
        : `יום ${i + 1}: יום שטוח — רק תרבות פסיבית ועצירות משניות, בלי עוגן חזק.`);
    if (d.length >= 2) {
      const last = d[d.length - 1];
      if (!isHighlight(last, audience) && !isActiveAnchor(last))
        fun.push(`יום ${i + 1} מסתיים בעצירה חלשה (${nameOf(last)}) — סיום אנטי-קליימקטי.`);
    }
  });
  const obscure = flat.filter(isObscure).length;
  if (flat.length && obscure / flat.length > 0.4) {
    fun.push(`${obscure} מתוך ${flat.length} עצירות אלמוניות (בלי תמונה/דירוג) — הטיול עלול להרגיש 'סתמי'.`);
    suggestions.add("להעשיר/לסנן אתרים אלמוניים, או להעדיף בבנייה אתרים עם consensus/תמונה.");
  }
  if (fun.some((f) => f.includes("שטוח")))
    suggestions.add("להעלות must-see/consensus לאתרי-המפתח בעיר, כדי שכל יום יקבל עוגן חזק.");
  if (fun.some((f) => f.includes("אנטי-קליימקטי")))
    suggestions.add("engine: לשקול סידור שמסיים יום באנקר החזק/הנופי ביותר (לא רק day-ender מים).");

  return { conformance, fun, suggestions: [...suggestions] };
}
