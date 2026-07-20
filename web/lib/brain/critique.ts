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

  // 4) variety — no long run of the same category within a day.
  {
    let penalty = 0;
    days.forEach((d, i) => {
      let run = 1;
      for (let k = 1; k < d.length; k++) {
        if (d[k].category === d[k - 1].category) { run++; if (run >= THRESHOLDS.maxSameCategoryRun) { penalty += 15; issues.push({ dim: "variety", severity: "warn", day: i + 1, msg: `יום ${i + 1}: רצף של ${run} מאותה קטגוריה (${d[k].category})` }); } }
        else run = 1;
      }
    });
    const distinctCats = new Set(all.map((a) => a.category)).size;
    dims.variety = clamp(60 + distinctCats * 8 - penalty);
  }

  // 5) pace — stops/day near the audience target.
  {
    const target = PACE_STOPS[audience];
    const perDay = days.map((d) => d.length);
    const avgOff = perDay.length ? perDay.reduce((s, n) => s + Math.abs(n - target), 0) / perDay.length : target;
    dims.pace = clamp(100 - avgOff * 22);
  }

  // 6) balance — days evenly filled.
  {
    const perDay = days.map((d) => d.length);
    const mean = perDay.reduce((s, n) => s + n, 0) / Math.max(1, perDay.length);
    const std = Math.sqrt(perDay.reduce((s, n) => s + (n - mean) ** 2, 0) / Math.max(1, perDay.length));
    dims.balance = clamp(100 - (std / THRESHOLDS.balanceStdMax) * 100);
    if (std > THRESHOLDS.balanceStdMax) issues.push({ dim: "balance", severity: "warn", msg: `ימים לא מאוזנים (${perDay.join("/")} עצירות)` });
    if (perDay.some((n) => n === 0)) issues.push({ dim: "balance", severity: "critical", msg: "יש יום ריק" });
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
