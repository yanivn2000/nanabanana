// The Brain's QUALITY CHECK (deterministic, no AI). Two lenses, per the editor:
//   1) conformance — does the built trip obey the enabled techniques/values?
//   2) fun — does it *sound enjoyable*? A trip can pass every setting and still be a
//      flat, museum-heavy, anticlimactic day. These are heuristic "fun signals".
// The output is structured findings; the route formats them into free text the editor
// pastes into chat, where Claude Code adds the deep (real-AI) judgment + fixes.
import type { Attraction } from "../db";
import { audienceFitScore, type Audience } from "./policy";
import type { BrainRules } from "./rules";
import { countVisits, isActiveAnchor, isSoftFun, stopMatchesType } from "./traits";

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

export function qualityCheck(
  days: Attraction[][], audience: Audience, rules: BrainRules,
  // eveningEnds[i]: day i of the BUILT itinerary ends at an evening street/square
  // (computed by the caller from the full stop list — richDays can't see synthetic
  // street stops). Present only when the city has a curated evening layer.
  // The evening is checked from the BUILT itinerary (richDays has no synthetic
  // street stops and no clock), so the caller measures it and passes it in.
  ctx: { cityMustCount: number; poolTypes?: number; eveningEnds?: boolean[];
    evening?: { afterDinner: number[]; lastStart: (number | null)[]; lateWrong: string[][]; repeats: { name: string; n: number }[] } }
): Quality {
  const conformance: QualityFinding[] = [];
  const fun: string[] = [];
  const suggestions = new Set<string>();
  const flat = days.flat();

  // ---- 1) CONFORMANCE — trip vs the enabled techniques -----------------------
  for (const cap of rules.maxTypePerDay) {
    // countVisits, not row count: a curated complex (the Vatican's four museums,
    // Prague's Jewish Museum and its synagogues) is one ticket and one visit.
    const bad = days.map((d, i) => ({ n: countVisits(d.filter((a) => stopMatchesType(a, cap.type))), i }))
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
  // Evening ending (evening_slot technique) — a no-kids day ends at a curated
  // evening street/square. Reported only when the city has the layer.
  if (audience !== "families" && ctx.eveningEnds) {
    const missing = ctx.eveningEnds.map((ok, i) => (ok ? null : i + 1)).filter((n): n is number => n != null);
    conformance.push(missing.length
      ? { ok: false, msg: `ימים בלי סיום-ערב (🌙): ${missing.map((n) => `יום ${n}`).join(", ")}` }
      : { ok: true, msg: "כל יום מסתיים במקום-ערב (🌙)" });
  }
  // ---- the evening as its own lens ------------------------------------------
  // The owner reads this section to answer one question: would I be happy with
  // how these evenings turned out? Everything here is measured on the clock of
  // the built trip, not on the pool.
  const ev = ctx.evening;
  if (ev) {
    const hardEndHe = `${String(Math.floor(rules.eveningHardEnd / 60)).padStart(2, "0")}:${String(rules.eveningHardEnd % 60).padStart(2, "0")}`;
    const over = ev.afterDinner.map((n, i) => ({ n, i })).filter((x) => x.n > rules.eveningMaxStops);
    conformance.push(over.length
      ? { ok: false, msg: `יותר מ-${rules.eveningMaxStops} עצירות אחרי ארוחת הערב: ${over.map((x) => `יום ${x.i + 1} (${x.n})`).join(", ")}` }
      : { ok: true, msg: `עד ${rules.eveningMaxStops} עצירות אחרי ארוחת הערב` });
    const late = ev.lastStart.map((m, i) => ({ m, i })).filter((x) => x.m != null && x.m >= rules.eveningHardEnd);
    conformance.push(late.length
      ? { ok: false, msg: `ימים שנמשכים אחרי ${hardEndHe}: ${late.map((x) => `יום ${x.i + 1} (${String(Math.floor((x.m as number) / 60)).padStart(2, "0")}:${String((x.m as number) % 60).padStart(2, "0")})`).join(", ")}` }
      : { ok: true, msg: `אף יום לא נמשך אחרי ${hardEndHe}` });
    const shut = ev.lateWrong.map((names, i) => ({ names, i })).filter((x) => x.names.length);
    conformance.push(shut.length
      ? { ok: false, msg: `מקומות סגורים בשעה שנקבעה להם: ${shut.map((x) => `יום ${x.i + 1} — ${x.names.join(", ")}`).join(" · ")}` }
      : { ok: true, msg: "אין מקום סגור בשעות הערב" });
    const rep = ev.repeats.filter((r) => r.n > 2);
    if (rep.length) conformance.push({ ok: false, msg: `מקום-ערב שחוזר יותר מפעמיים: ${rep.map((r) => `${r.name} (${r.n})`).join(", ")}` });
    // fun lens: an evening that is only a walk-past is thin
    const noEvening = ev.afterDinner.filter((n) => n === 0).length;
    if (audience !== "families" && noEvening && ctx.eveningEnds)
      fun.push(`ב-${noEvening} ${noEvening === 1 ? "יום" : "ימים"} אין שום דבר אחרי ארוחת הערב — הערב נגמר עם הקינוח`);
  }

  // One place, one day. Prague's build put three enclosures of the SAME zoo on two
  // different days — the family would have crossed to Troja twice and paid twice.
  // The data fix (parent_id + is_component) removed that case; this makes sure the
  // class of bug can never come back quietly, for any curated complex.
  const dayOfVisit = new Map<number, number[]>();
  days.forEach((d, i) => {
    for (const key of new Set(d.map((a) => a.parent_id ?? a.id))) {
      const at = dayOfVisit.get(key); at ? at.push(i + 1) : dayOfVisit.set(key, [i + 1]);
    }
  });
  const split = [...dayOfVisit.entries()].filter(([, ds]) => ds.length > 1)
    .map(([key, ds]) => {
      // Name the VENUE, not whichever enclosure happened to come first.
      const row = flat.find((a) => a.id === key) ?? flat.find((a) => (a.parent_id ?? a.id) === key)!;
      return `${nameOf(row)} (ימים ${ds.join(", ")})`;
    });
  if (split.length)
    conformance.push({ ok: false, msg: `אותו מקום מפוצל בין ימים — כרטיס אחד, נסיעה כפולה: ${split.join(" · ")}` });

  const weakFit = flat.filter((a) => audienceFitScore(a.audience_fit, audience) < rules.minAudienceFit).length;
  if (flat.length && weakFit > flat.length / 2)
    conformance.push({ ok: false, msg: `רוב העצירות (${weakFit}/${flat.length}) בהתאמה נמוכה ל${audience === "families" ? "משפחות" : "מבוגרים"}` });

  // ---- 2) FUN — does it sound enjoyable? -------------------------------------
  // Experience diversity, judged against what the CITY HAS — not an absolute.
  // The old test was `types < days + 1`, so a 4-day trip needed 5 distinct types.
  // Ten cities in the DB (Dubai, Marseille, Mykonos, Hanoi…) contain only 4 types
  // in their entire pool: they failed this every single run, with an "insight"
  // telling the engine to stream in types that do not exist. A check that can
  // never be satisfied is noise, and noise teaches the editor to skip the section.
  // So: compare to the achievable ceiling, and name the right culprit — the
  // engine when it left variety on the table, the CONTENT when there is none.
  const types = new Set(flat.map(expType));
  const ceiling = Math.min(ctx.poolTypes ?? 99, Math.max(3, days.length + 1));
  if (flat.length && types.size < ceiling) {
    fun.push(`גיוון-חוויה נמוך — ${types.size} סוגי-חוויה בטיול, מתוך ${ctx.poolTypes ?? "?"} שקיימים בעיר.`);
    suggestions.add("להחמיר max_type_per_day או להזרים יותר סוגי-חוויה (טבע/אוכל/פעילות) לימים.");
  } else if (flat.length && ctx.poolTypes != null && ctx.poolTypes <= 4 && types.size >= ctx.poolTypes) {
    // Not an engine failure — it used everything there was. Still worth saying:
    // the trip WILL feel samey, and only content can fix it.
    fun.push(`המוח מיצה את מה שיש (${types.size}/${ctx.poolTypes} סוגי-חוויה בעיר) — הגיוון חסום בתוכן, לא במנוע.`);
    suggestions.add("פער תוכן: לעיר הזו חסרים סוגי-חוויה (אוכל/פעילות/חמד) — להעשיר את המאגר.");
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
