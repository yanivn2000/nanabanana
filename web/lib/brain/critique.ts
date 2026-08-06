// The Brain — the critic (deterministic, no AI). See docs/logic/brain.md.
//
// Scores a built trip (days of attractions) on quality dimensions and raises
// specific issues. This IS the Brain's fitness function: the editor calibrates it
// (teaches it what "good" means, via policy.ts), and the builder optimises toward
// it. Operates on the clustered attractions (rich: coords, category, must_see,
// audience_fit), which is the real day structure.
import type { Attraction } from "../db";
import { dayLegStats } from "../cluster";
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
  days: Attraction[][], audience: Audience,
  // dayMeta.eveningEnd: the built day's LAST real stop is an evening street/square
  // (or the traveller's own nightlife pick). eveningCity: the city has a curated
  // evening layer at all — without it the check stays silent (nothing to demand).
  ctx: { cityMustCount: number; rules?: BrainRules; dayMeta?: { car?: boolean; eveningEnd?: boolean }[]; eveningCity?: boolean }
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

  // 1) walkability — each day within the comfort band. Car days (ctx.dayMeta)
  // count only walkable hops as WALKING — the long legs are drives, reported as
  // ק"מ נסיעה instead of flagging a 17km "walk" nobody takes. Messages carry km
  // so the editor can judge terrain, not just minutes.
  {
    let sum = 0;
    days.forEach((d, i) => {
      const car = !!ctx.dayMeta?.[i]?.car;
      const { walkMin: w, walkKm, rideKm } = dayLegStats(d, car);
      // 100 at ideal, linearly down to 0 at 2×flag.
      sum += clamp(100 - Math.max(0, w - dayWalkIdeal) / (2 * dayWalkFlag - dayWalkIdeal) * 100);
      if (w > dayWalkFlag) issues.push({ dim: "walkability", severity: "warn", day: i + 1,
        msg: `יום ${i + 1}: ${Math.round(w)} דק׳ הליכה (${walkKm.toFixed(1)} ק״מ${rideKm > 0 ? ` + ${rideKm.toFixed(0)} ק״מ ${car ? "נסיעה" : "במטרו"}` : ""}) — יותר מדי` });
    });
    dims.walkability = days.length ? Math.round(sum / days.length) : 0;
  }

  // 1b) evening ending (no-kids trips): every day should END at an evening
  // street/square (the 🌙 layer) or at the traveller's own nightlife pick — the
  // evening_slot product promise. Only checked where the city HAS curated evening
  // spots; a city without them gets a curation nudge, not per-day noise.
  if (audience !== "families" && ctx.eveningCity) {
    days.forEach((_, i) => {
      if (!ctx.dayMeta?.[i]?.eveningEnd)
        issues.push({ dim: "eveningEnd", severity: "warn", day: i + 1,
          msg: `יום ${i + 1} לא מסתיים במקום-ערב (רחוב/כיכר 🌙) — טיול זוגות אמור להיגמר בבילוי ערב` });
    });
  }

  // 1c) thin day — a NON-final day with ≤2 stops and under ~5h of touring reads as
  // a hole in the plan (Paphos's lone-waterpark day 2). The LAST day is exempt by
  // policy: it's the going-home day and is supposed to be lighter. A single big
  // anchor (a 2½h+ palace/market) still passes via the minutes test.
  {
    const dwellCfg = R?.dwell ?? DWELL_DEFAULT;
    days.forEach((d, i) => {
      if (i === days.length - 1 || !d.length) return;
      const mins = d.reduce((s, a) => s + dwellMinutes(a, dwellCfg), 0);
      if (d.length <= 2 && mins < 300)
        issues.push({ dim: "thinDay", severity: "warn", day: i + 1,
          msg: `יום ${i + 1} דל — ${d.length} עצירות (~${Math.round(mins / 60)} שע׳) בלי עוגן גדול; כדאי להשלים או למזג` });
    });
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
      // Report each MAXIMAL run once. The old loop fired on every step past the
      // threshold, so one run of 5 produced three lines (3, 4, 5) and was
      // penalised three times over — noise in the report and a score the run
      // length quietly tripled.
      let start = 0;
      const flush = (end: number) => {
        const run = end - start;
        if (run < maxSameRun) return;
        penalty += 12 + (run - maxSameRun) * 6;   // longer run = worse, but once
        issues.push({ dim: "variety", severity: "warn", day: i + 1,
          msg: `יום ${i + 1}: רצף של ${run} מאותו סוג חוויה (${expType(d[start])})` });
      };
      for (let k = 1; k < d.length; k++) {
        if (expType(d[k]) !== expType(d[k - 1])) { flush(k); start = k; }
      }
      flush(d.length);
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
    // Day time = dwell + walking + RIDING (car ~45 km/h + parking; metro ~22 km/h
    // door-to-door), so a one-beach car day or a cross-town metro hop isn't
    // scored as an empty/short day.
    const times = days.map((d, i) => {
      const car = !!ctx.dayMeta?.[i]?.car;
      const { walkMin, rideKm } = dayLegStats(d, car);
      return d.reduce((s, a) => s + dwellMinutes(a, dwell), 0) + walkMin +
        (rideKm / (car ? 45 : 22)) * 60 + (car && rideKm > 0 ? 8 : 0);
    });
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
    days.forEach((d, i) => { const { walkMin: w } = dayLegStats(d, !!ctx.dayMeta?.[i]?.car); sum += clamp(100 - w / 2); });
    dims.coherence = days.length ? Math.round(sum / days.length) : 0;
  }

  const score = clamp(Object.entries(weights).reduce((s, [k, w]) => s + (dims[k] ?? 0) * w, 0));
  const needsWork = score < qualityBar || issues.some((i) => i.severity === "critical");
  return { score, dims, issues, needsWork, stops };
}
