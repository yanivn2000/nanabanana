// The Brain — the critic (deterministic, no AI). See docs/logic/brain.md.
//
// Scores a built trip (days of attractions) on quality dimensions and raises
// specific issues. This IS the Brain's fitness function: the editor calibrates it
// (teaches it what "good" means, via policy.ts), and the builder optimises toward
// it. Operates on the clustered attractions (rich: coords, category, must_see,
// audience_fit), which is the real day structure.
import type { Attraction } from "../db";
import { dayWalkMinutes } from "../cluster";
import { AUDIENCE_PREFS, DAY_WALK, PACE_STOPS, QUALITY_BAR, THRESHOLDS, WEIGHTS, audienceFitScore, type Audience } from "./policy";
import { DWELL_DEFAULT, dwellMinutes, isActiveAnchor, isSoftFun, stopMatchesType } from "./traits";
import type { BrainRules } from "./rules";

export type Issue = { dim: string; severity: "critical" | "warn"; msg: string; day?: number };
export type Critique = {
  score: number;                       // 0–100 overall
  dims: Record<string, number>;        // per-dimension 0–100
  issues: Issue[];
  needsWork: boolean;
  stops: number;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const fit = (a: Attraction, aud: Audience) => audienceFitScore(a.audience_fit, aud);
// Experience type — a semantic signal (universal/family/romantic/foodie/cultural/
// outdoors…) far finer than the coarse OSM `category` for judging variety.
const expType = (a: Attraction) => a.audience_fit?.type || a.category;
// Minutes a stop takes (visit), matching the clusterer's dwell model.

export function critiqueTrip(
  days: Attraction[][], audience: Audience, ctx: { cityMustCount: number; rules?: BrainRules }
): Critique {
  const prefs = AUDIENCE_PREFS[audience];
  const all = days.flat();
  const stops = all.length;
  const issues: Issue[] = [];
  const dims: Record<string, number> = {};
  // Tier-3 critic calibration — from the principles (ctx.rules), else policy defaults.
  const R = ctx.rules;
  const dayWalkIdeal = R?.dayWalkIdeal ?? DAY_WALK.ideal;
  const dayWalkFlag = R?.dayWalkFlag ?? DAY_WALK.flag;
  const minMustSee = R?.minMustSee ?? THRESHOLDS.minMustSeePerTrip;
  const minAudFit = R?.minAudienceFit ?? THRESHOLDS.minAudienceFit;
  const maxSameRun = R?.maxSameTypeRun ?? THRESHOLDS.maxSameTypeRun;
  const paceTarget = R?.paceStops[audience] ?? PACE_STOPS[audience];
  const weights = R?.weights ?? WEIGHTS;
  const qualityBar = R?.qualityBar ?? QUALITY_BAR;

  // 1) walkability — each day within the comfort band.
  {
    let sum = 0;
    days.forEach((d, i) => {
      const w = dayWalkMinutes(d);
      // 100 at ideal, linearly down to 0 at 2×flag.
      sum += clamp(100 - Math.max(0, w - dayWalkIdeal) / (2 * dayWalkFlag - dayWalkIdeal) * 100);
      if (w > dayWalkFlag) issues.push({ dim: "walkability", severity: "warn", day: i + 1, msg: `יום ${i + 1}: ${Math.round(w)} דק׳ הליכה — יותר מדי` });
    });
    dims.walkability = days.length ? Math.round(sum / days.length) : 0;
  }

  // 2) must-see coverage — hits enough of the city's real must-sees.
  {
    const mustInTrip = all.filter((a) => a.must_see === 1).length;
    const target = Math.max(minMustSee, Math.min(ctx.cityMustCount, stops));
    dims.mustSee = clamp((mustInTrip / Math.max(1, target)) * 100);
    if (mustInTrip < minMustSee)
      issues.push({ dim: "mustSee", severity: "critical", msg: `רק ${mustInTrip} אתרי חובה בטיול — מעט מדי` });
  }

  // 3) audience fit — stops genuinely suit this segment.
  {
    const avg = all.length ? all.reduce((s, a) => s + fit(a, audience), 0) / all.length : 0;
    dims.audienceFit = clamp(avg);
    const weak = all.filter((a) => fit(a, audience) < minAudFit).length;
    if (weak > stops / 2)
      issues.push({ dim: "audienceFit", severity: "warn", msg: `רוב העצירות בהתאמה נמוכה ל${audience === "families" ? "משפחות עם ילדים" : "מטיילים בלי ילדים"}` });
    // family-specific: kid-friendliness
    if (prefs.kidFriendly) {
      const kidOk = all.filter((a) => (a.family_score ?? 0) >= 6).length;
      if (kidOk < stops / 2) issues.push({ dim: "audienceFit", severity: "warn", msg: "מעט אטרקציות ידידותיות-ילדים" });
    }
    // active-anchor technique (principles): audiences that require it get a day with
    // no active anchor flagged. Default (no rules) = families, per the v1.2 note.
    const needsActive = ctx.rules ? ctx.rules.activeAnchorAudiences.includes(audience) : audience === "families";
    if (needsActive) {
      // Data-driven anchor (not a keyword list): a day is fine if it has an active/
      // experiential place, a park/headline attraction (isSoftFun), OR a stop the
      // consensus marks a real highlight for this audience (fit ≥ 70). Only a day with
      // NONE is docked — so a dinosaur hall / salt mine / Tower of London day passes.
      days.forEach((d, i) => {
        const hasAnchor = d.some((a) => isActiveAnchor(a) || isSoftFun(a) || fit(a, audience) >= 70);
        if (d.length >= THRESHOLDS.minFamilyStopsForAnchor && !hasAnchor) {
          issues.push({ dim: "audienceFit", severity: "warn", day: i + 1, msg: `יום ${i + 1}: אין עוגן פעיל/חוויתי — היום עלול להרגיש שטוח` });
          dims.audienceFit = clamp(dims.audienceFit - 8);
        }
      });
    }
    // max-type-per-day technique (e.g. ≤2 museums/day) — flag any day over the cap.
    for (const cap of ctx.rules?.maxTypePerDay ?? []) {
      days.forEach((d, i) => {
        const n = d.filter((a) => stopMatchesType(a, cap.type)).length;
        if (n > cap.max) issues.push({ dim: "variety", severity: "warn", day: i + 1, msg: `יום ${i + 1}: ${n} ${cap.type} — מעל המקסימום (${cap.max})` });
      });
    }
  }

  // 4) variety — no long run of the same EXPERIENCE TYPE within a day (v1.1: by
  //    audience_fit.type, since raw OSM category is too coarse — "attraction"
  //    covers most landmarks and unfairly tanked variety).
  {
    let penalty = 0;
    days.forEach((d, i) => {
      let run = 1;
      for (let k = 1; k < d.length; k++) {
        if (expType(d[k]) === expType(d[k - 1])) { run++; if (run >= maxSameRun) { penalty += 12; issues.push({ dim: "variety", severity: "warn", day: i + 1, msg: `יום ${i + 1}: רצף של ${run} מאותו סוג חוויה (${expType(d[k])})` }); } }
        else run = 1;
      }
    });
    const distinctTypes = new Set(all.map(expType)).size;
    dims.variety = clamp(55 + distinctTypes * 12 - penalty);
  }

  // 5) pace — stops/day near the audience target.
  {
    const target = paceTarget;
    const perDay = days.map((d) => d.length);
    const avgOff = perDay.length ? perDay.reduce((s, n) => s + Math.abs(n - target), 0) / perDay.length : target;
    dims.pace = clamp(100 - avgOff * 22);
  }

  // 6) balance — days evenly filled by TIME, not stop count (v1.1: a tight 6-stop
  //    day and a spread 4-stop day can take the same hours — count-balance
  //    over-penalised the former).
  {
    const dwell = R?.dwell ?? DWELL_DEFAULT;
    const times = days.map((d) => d.reduce((s, a) => s + dwellMinutes(a, dwell), 0) + dayWalkMinutes(d));
    const mean = times.reduce((s, n) => s + n, 0) / Math.max(1, times.length);
    const std = Math.sqrt(times.reduce((s, n) => s + (n - mean) ** 2, 0) / Math.max(1, times.length));
    dims.balance = clamp(100 - (std / THRESHOLDS.balanceTimeStdMax) * 100);
    if (std > THRESHOLDS.balanceTimeStdMax) issues.push({ dim: "balance", severity: "warn", msg: `ימים לא מאוזנים בזמן (${days.map((d) => d.length).join("/")} עצירות)` });
    if (days.some((d) => d.length === 0)) issues.push({ dim: "balance", severity: "critical", msg: "יש יום ריק" });
  }

  // 7) coherence — each day is one tight area (proxy: low intra-day walk already
  //    in walkability; here reward days whose stops are geographically compact).
  {
    let sum = 0;
    days.forEach((d) => { const w = dayWalkMinutes(d); sum += clamp(100 - w / 2); });
    dims.coherence = days.length ? Math.round(sum / days.length) : 0;
  }

  const score = clamp(Object.entries(weights).reduce((s, [k, w]) => s + (dims[k] ?? 0) * w, 0));
  const needsWork = score < qualityBar || issues.some((i) => i.severity === "critical");
  return { score, dims, issues, needsWork, stops };
}
