// The Brain — the critic (deterministic, no AI). See docs/logic/brain.md.
//
// Scores a built trip (days of attractions) on quality dimensions and raises
// specific issues. This IS the Brain's fitness function: the editor calibrates it
// (teaches it what "good" means, via policy.ts), and the builder optimises toward
// it. Operates on the clustered attractions (rich: coords, category, must_see,
// audience_fit), which is the real day structure.
import type { Attraction } from "../db";
import { dayWalkMinutes } from "../cluster";
import { AUDIENCE_PREFS, DAY_WALK, PACE_STOPS, QUALITY_BAR, THRESHOLDS, WEIGHTS, type Audience } from "./policy";

export type Issue = { dim: string; severity: "critical" | "warn"; msg: string; day?: number };
export type Critique = {
  score: number;                       // 0–100 overall
  dims: Record<string, number>;        // per-dimension 0–100
  issues: Issue[];
  needsWork: boolean;
  stops: number;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const fit = (a: Attraction, aud: Audience) => a.audience_fit?.[aud] ?? 0;
// Experience type — a semantic signal (universal/family/romantic/foodie/cultural/
// outdoors…) far finer than the coarse OSM `category` for judging variety.
const expType = (a: Attraction) => a.audience_fit?.type || a.category;
// Minutes a stop takes (visit), matching the clusterer's model.
const visitMin = (a: Attraction) => { const d = a.duration_minutes ?? 0; return d ? Math.max(40, Math.min(150, d)) : 75; };

export function critiqueTrip(
  days: Attraction[][], audience: Audience, ctx: { cityMustCount: number }
): Critique {
  const prefs = AUDIENCE_PREFS[audience];
  const all = days.flat();
  const stops = all.length;
  const issues: Issue[] = [];
  const dims: Record<string, number> = {};

  // 1) walkability — each day within the comfort band.
  {
    let sum = 0;
    days.forEach((d, i) => {
      const w = dayWalkMinutes(d);
      // 100 at ideal, linearly down to 0 at 2×flag.
      sum += clamp(100 - Math.max(0, w - DAY_WALK.ideal) / (2 * DAY_WALK.flag - DAY_WALK.ideal) * 100);
      if (w > DAY_WALK.flag) issues.push({ dim: "walkability", severity: "warn", day: i + 1, msg: `יום ${i + 1}: ${Math.round(w)} דק׳ הליכה — יותר מדי` });
    });
    dims.walkability = days.length ? Math.round(sum / days.length) : 0;
  }

  // 2) must-see coverage — hits enough of the city's real must-sees.
  {
    const mustInTrip = all.filter((a) => a.must_see === 1).length;
    const target = Math.max(THRESHOLDS.minMustSeePerTrip, Math.min(ctx.cityMustCount, stops));
    dims.mustSee = clamp((mustInTrip / Math.max(1, target)) * 100);
    if (mustInTrip < THRESHOLDS.minMustSeePerTrip)
      issues.push({ dim: "mustSee", severity: "critical", msg: `רק ${mustInTrip} אתרי חובה בטיול — מעט מדי` });
  }

  // 3) audience fit — stops genuinely suit this segment.
  {
    const avg = all.length ? all.reduce((s, a) => s + fit(a, audience), 0) / all.length : 0;
    dims.audienceFit = clamp(avg);
    const weak = all.filter((a) => fit(a, audience) < THRESHOLDS.minAudienceFit).length;
    if (weak > stops / 2)
      issues.push({ dim: "audienceFit", severity: "warn", msg: `רוב העצירות בהתאמה נמוכה ל${audience === "families" ? "משפחות" : audience === "couples" ? "זוגות" : "חברים"}` });
    // family-specific: kid-friendliness
    if (prefs.kidFriendly) {
      const kidOk = all.filter((a) => (a.family_score ?? 0) >= 6).length;
      if (kidOk < stops / 2) issues.push({ dim: "audienceFit", severity: "warn", msg: "מעט אטרקציות ידידותיות-ילדים" });
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
        if (expType(d[k]) === expType(d[k - 1])) { run++; if (run >= THRESHOLDS.maxSameTypeRun) { penalty += 12; issues.push({ dim: "variety", severity: "warn", day: i + 1, msg: `יום ${i + 1}: רצף של ${run} מאותו סוג חוויה (${expType(d[k])})` }); } }
        else run = 1;
      }
    });
    const distinctTypes = new Set(all.map(expType)).size;
    dims.variety = clamp(55 + distinctTypes * 12 - penalty);
  }

  // 5) pace — stops/day near the audience target.
  {
    const target = PACE_STOPS[audience];
    const perDay = days.map((d) => d.length);
    const avgOff = perDay.length ? perDay.reduce((s, n) => s + Math.abs(n - target), 0) / perDay.length : target;
    dims.pace = clamp(100 - avgOff * 22);
  }

  // 6) balance — days evenly filled by TIME, not stop count (v1.1: a tight 6-stop
  //    day and a spread 4-stop day can take the same hours — count-balance
  //    over-penalised the former).
  {
    const times = days.map((d) => d.reduce((s, a) => s + visitMin(a), 0) + dayWalkMinutes(d));
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

  const score = clamp(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (dims[k] ?? 0) * w, 0));
  const needsWork = score < QUALITY_BAR || issues.some((i) => i.severity === "critical");
  return { score, dims, issues, needsWork, stops };
}
