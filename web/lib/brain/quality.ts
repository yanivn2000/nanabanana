// The Brain's QUALITY CHECK (deterministic, no AI). Two lenses, per the editor:
//   1) conformance — does the built trip obey the enabled techniques/values?
//   2) fun — does it *sound enjoyable*? A trip can pass every setting and still be a
//      flat, museum-heavy, anticlimactic day. These are heuristic "fun signals".
// The output is structured findings; the route formats them into free text the editor
// pastes into chat, where Claude Code adds the deep (real-AI) judgment + fixes.
import type { Attraction } from "../db";
import { audienceFitScore, type Audience } from "./policy";
import type { BrainRules } from "./rules";
import { isActiveAnchor, stopMatchesType } from "./traits";

const expType = (a: Attraction) => a.audience_fit?.type || a.category;
const nameOf = (a: Attraction) => a.name_he || a.name_en;
const isHighlight = (a: Attraction, aud: Audience) => a.must_see === 1 || audienceFitScore(a.audience_fit, aud) >= 70;
const isObscure = (a: Attraction) => a.must_see !== 1 && !a.image_url &&
  audienceFitScore(a.audience_fit, "families") < 40 && audienceFitScore(a.audience_fit, "adults") < 40;
const PASSIVE = new Set(["museum", "historic", "cultural", "culture", "memorial", "attraction"]);
const isPassiveCulture = (a: Attraction) => PASSIVE.has(a.category) || PASSIVE.has(String(a.audience_fit?.type));

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
  if (rules.activeAnchorAudiences.includes(audience)) {
    const bad = days.map((d, i) => ({ d, i })).filter((x) => x.d.length >= 3 && !x.d.some(isActiveAnchor)).map((x) => `יום ${x.i + 1}`);
    conformance.push(bad.length ? { ok: false, msg: `ימים בלי אנקר פעיל: ${bad.join(", ")}` } : { ok: true, msg: "אנקר פעיל בכל יום" });
    if (bad.length) suggestions.add("להוסיף/לחזק אנקר פעיל (רכבל/מזחלות/קניון/בריכה) בימים שסומנו — או להעשיר את מאגר האנקרים הפעילים בעיר.");
  }
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
  days.forEach((d, i) => {
    if (d.length && !d.some((a) => isHighlight(a, audience)))
      fun.push(`יום ${i + 1}: אין אטרקציית-שיא (must-see / התאמה גבוהה) — היום מרגיש 'שטוח'.`);
    if (d.length >= 3 && d.every(isPassiveCulture))
      fun.push(`יום ${i + 1}: כולו תרבות פסיבית (מוזיאונים/כנסיות) — חסר טבע/פעילות/כיף.`);
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
