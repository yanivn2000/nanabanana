import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { listDestinations, topAttractions, areasForDestination, brainRulesForDest, approvedStreetsForCity, nightPassbyForCity, type Attraction } from "@/lib/db";
import { annotateDaysWithAreas } from "@/lib/cluster";
import { buildCarBaseItinerary, buildHeuristicItinerary, streetAsStop } from "@/lib/heuristic";
import { CONTROL_PROBES, controlPenalty, controlVerdicts, globalControlVerdicts, type ControlResult } from "@/lib/brain/controls";
import { rankByTaste } from "@/lib/taste";
import { qualityCheck, type Quality } from "@/lib/brain/quality";
import { critiqueTrip, type Issue } from "@/lib/brain/critique";
import { isWrongAfterDark } from "@/lib/brain/traits";
import { haversineKm } from "@/lib/geo";
import { BRAIN_VERSION, poolValue, reachPenalty, type Audience } from "@/lib/brain/policy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AUDIENCES: Audience[] = ["families", "adults"];

// The Brain's self-evaluation: build a family/couples/friends trip for each city
// (deterministic — NO AI), critique each, and return a report. This is the
// "software test" loop — the report is what the editor reviews and what a Claude
// Code session reads to calibrate policy.ts.
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const days: number = b.days ?? 3;
  const month: number = b.month ?? 7;   // season for the eval (default: summer / July)
  // Deep check (בדיקת עומק): re-build each city×audience with N different variety
  // seeds and report the SCORE RANGE — a narrow range means the lottery is healthy,
  // a wide one means the city's middle layer is thin enough for luck to matter.
  const seedsN = Math.min(Math.max(Number(b.seeds) || 1, 1), 7);
  const dests = await listDestinations();
  const cityIds: number[] = Array.isArray(b.cities) && b.cities.length
    ? b.cities : dests.slice(0, 6).map((d) => d.id);

  const report: unknown[] = [];
  for (const id of cityIds) {
    const dest = dests.find((d) => d.id === id);
    if (!dest) continue;
    const attractions = await topAttractions(id, 150);
    const cityMustCount = attractions.filter((a) => a.must_see === 1).length;
    const areas = await areasForDestination(id);
    const rules = await brainRulesForDest(id);   // the Brain's techniques for this city
    // The curated evening layer (streets.evening) — the eval builds couples trips
    // WITH it, exactly like the consumer route, and then checks every day ends there.
    const eveningSpots = (await approvedStreetsForCity(id)).filter((s) => s.evening).map(streetAsStop);
    const eveningIds = new Set(eveningSpots.map((s) => s.id));
    // Floodlit-but-shut icons — the eval must see the same pass-by stops prod does.
    const nightIcons = rules.nightPassbyMax > 0 ? await nightPassbyForCity(id) : [];
    // For the audience-identity check: the built stop-id set per audience.
    const builtIds: Partial<Record<Audience, Set<number>>> = {};
    for (const audience of AUDIENCES) {
      const isFamily = audience === "families";
      const pace = rules.paceStops[audience];
      const center = { lat: dest.lat, lng: dest.lng };
      const carBase = dest.mobility === "car_base";
      // audience-ranked pool by blended value (must-see boost + fit + texture), minus a
      // reach penalty for far metro outliers, so days get markets/food/neighbourhoods
      // and don't sprawl to a 12km-away park.
      const dist = new Map(attractions.map((a) => [a.id, a.lat != null && a.lng != null ? haversineKm(center.lat, center.lng, a.lat, a.lng) : 0]));
      const val = (a: Attraction) => poolValue(a, audience) - reachPenalty(dist.get(a.id) ?? 0, !carBase);
      const pool = [...attractions].sort((x: Attraction, y: Attraction) => val(y) - val(x));
      const buildOpts = { month, seasonFilter: rules.seasonFilter, dayEnderLast: rules.dayEnderLast, maxTypePerDay: rules.maxTypePerDay, avoidCats: rules.avoid[audience] ?? [],
        dayStartMin: rules.dayStartMin, lunchAfterMin: rules.lunchAfterMin, lunchMinutes: rules.lunchMinutes, dwell: rules.dwell,
        daytripThresholdKm: rules.daytripThresholdKm, daytripPerDays: rules.daytripPerDays, daytripMaxStops: rules.daytripMaxStops,
        samePlaceMeters: rules.samePlaceMeters, freeGemMaxPerDay: rules.freeGemMaxPerDay, freeGemDetourMin: rules.freeGemDetourMin,
        // FIXED per-city seed: the eval must be reproducible run-to-run, and both
        // audiences must share a seed or the variety layer would fake audience
        // differentiation and blind the identity check. (Deep mode overrides seed
        // per iteration below — still a fixed, reproducible list.)
        seed: id, varietyJitter: rules.varietyJitter,
        ...(!isFamily && eveningSpots.length ? { eveningSpots, eveningStartMin: rules.eveningStart } : {}),
        ...(!isFamily && nightIcons.length ? { nightIcons, nightIconMax: rules.nightPassbyMax,
          nightIconKm: rules.nightPassbyKm, nightIconMinutes: rules.nightPassbyMinutes } : {}) ,
        eveningMaxStops: rules.eveningMaxStops, eveningHardEnd: rules.eveningHardEnd,
        minDayStops: rules.minDayStops, thinMergeKm: rules.thinMergeKm };
      // Build via the REAL consumer engine so the eval reflects exactly what a
      // traveller gets (dwell model, dedup, car day-trips) — one source of truth.
      // The CANONICAL trip mirrors the consumer's best-of-N policy deterministically:
      // build the whole fixed seed ladder, score everything, and report the BEST of
      // the first `buildCandidates` (ties → lowest index — no randomness in the
      // eval). Deep mode (b.seeds) just extends the ladder for the range display.
      const byId = new Map(attractions.map((a) => [a.id, a]));
      const ladderN = Math.max(seedsN, Math.max(1, rules.buildCandidates));
      const variants = Array.from({ length: ladderN }, (_, i) => id + i * 101).map((s) => {
        const o = { ...buildOpts, seed: s };
        const it = carBase
          ? buildCarBaseItinerary(dest.city, dest.country, days, pool, center, isFamily, pace, 3, o)
          : buildHeuristicItinerary(dest.city, dest.country, days, pool, isFamily, pace, 3, undefined, o);
        const rich: Attraction[][] = it.days.map((d) =>
          d.stops.map((st) => (st.id != null ? byId.get(st.id) : undefined)).filter((a): a is Attraction => !!a));
        // Car-awareness for the critic: a car_base trip drives every day, a dayTrip
        // in any city; eveningEnd reads the BUILT stops (street ids are synthetic).
        const meta = it.days.map((d) => {
          const real = d.stops.filter((st) => st.id != null);
          const lastId = real.length ? real[real.length - 1].id : null;
          // names of stops scheduled past 20:30 that are shut at that hour
          const lateWrong = d.stops.filter((st) => {
            if (!st.time || st.id == null) return false;
            const [hh, mm] = st.time.split(":").map(Number);
            if ((hh || 0) * 60 + (mm || 0) < 20 * 60 + 30) return false;
            // A deliberate pass-by of a floodlit icon is not a mistake — the
            // stop says so, and the traveller is told the place is shut.
            if (st.passby) return false;
            const at = byId.get(st.id);
            return !!at && isWrongAfterDark(at);
          }).map((st) => st.name);
          return { car: carBase || !!d.dayTrip, eveningEnd: lastId != null && eveningIds.has(lastId), lateWrong };
        });
        const critV = critiqueTrip(rich, audience, { cityMustCount, rules, dayMeta: meta, eveningCity: eveningSpots.length > 0 });
        return { it, rich, meta, crit: critV };
      });
      let ci = 0;
      for (let i = 1; i < Math.min(Math.max(1, rules.buildCandidates), variants.length); i++)
        if (variants[i].crit.score > variants[ci].crit.score) ci = i;
      const { it: itinerary, rich: richDays, meta: dayMeta, crit } = variants[ci];
      // DOES THE CONTROL DO ANYTHING? Re-build this exact city on the SAME seed
      // with one input changed, and compare stop lists. A control that changes
      // nothing is a promise the product is not keeping — the distance slider
      // looked like a working feature for weeks. See lib/brain/controls.ts.
      const controlBase = variants[ci].it;
      const controls = controlVerdicts(controlBase, CONTROL_PROBES.map((probe) => {
        if (probe.mobility && (probe.mobility === "car_base") !== carBase) {
          return { probe, itinerary: null };   // cannot bite here — not a failure
        }
        const v = probe.variant as Record<string, unknown>;
        // Everything below mirrors the canonical build EXACTLY except the one
        // input under test, including the seed — that is what makes a difference
        // attributable to the control rather than to the lottery.
        const o = { ...buildOpts, seed: id + ci * 101,
          ...(v.maxDriveMin ? { maxDriveMin: v.maxDriveMin as number } : {}) };
        const fam = v.flipAudience ? !isFamily : isFamily;          // flip, don't restate
        const pc = typeof v.paceStops === "number" ? v.paceStops : pace;
        const wp = typeof v.walkPref === "number" ? v.walkPref : 3;
        // taste has no path through buildOpts — it shapes the POOL, exactly as the
        // consumer route does with rankByTaste.
        const p2 = v.taste
          ? rankByTaste(attractions, v.taste as Record<string, number>, 90, fam, [], audience)
          : pool;
        const it2 = carBase
          ? buildCarBaseItinerary(dest.city, dest.country, days, p2, center, fam, pc, wp, o)
          : buildHeuristicItinerary(dest.city, dest.country, days, p2, fam, pc, wp, undefined, o);
        return { probe, itinerary: it2 };
      }));
      const seedScores: number[] = seedsN > 1 ? variants.map((v) => v.crit.score) : [];
      annotateDaysWithAreas(itinerary.days, areas, center);
      // Measure the evening off the built clock: how many stops start after
      // dinner, when the last one starts, what is shut at that hour, and whether
      // one evening spot carries too many nights.
      const startMin = (tm?: string) => {
        if (!tm || tm.length < 4) return null;
        const [h, m] = tm.split(":").map(Number);
        return Number.isFinite(h) ? (h || 0) * 60 + (m || 0) : null;
      };
      const real = (d: (typeof itinerary.days)[number]) => d.stops.filter((s) => s.kind !== "food" && s.kind !== "rest");
      const evNames = new Map<string, number>();
      for (const d of itinerary.days)
        for (const s of real(d)) {
          const m = startMin(s.time);
          if (m != null && m >= 19 * 60 + 30) evNames.set(s.name, (evNames.get(s.name) ?? 0) + 1);
        }
      const evening = {
        afterDinner: itinerary.days.map((d) => real(d).filter((s) => (startMin(s.time) ?? 0) >= 19 * 60 + 30).length),
        lastStart: itinerary.days.map((d) => {
          const ms = real(d).map((s) => startMin(s.time)).filter((m): m is number => m != null);
          return ms.length ? Math.max(...ms) : null;
        }),
        lateWrong: dayMeta.map((m) => m.lateWrong ?? []),
        repeats: [...evNames].map(([name, n]) => ({ name, n })),
      };
      const quality: Quality | undefined = b.quality ? qualityCheck(richDays, audience, rules, { cityMustCount, evening,
        ...(eveningSpots.length ? { eveningEnds: dayMeta.map((m) => m.eveningEnd) } : {}) }) : undefined;
      builtIds[audience] = new Set(richDays.flat().map((a) => a.id));
      report.push({
        cityId: id, city: dest.city_he || dest.city, cityEn: dest.city, country: dest.country, audience, days,
        ...(seedScores.length ? { seedScores } : {}),
        controls, score: crit.score, needsWork: crit.needsWork, stops: crit.stops,
        dims: crit.dims, issues: crit.issues, itinerary, quality,
        daysNames: richDays.map((d) => d.map((a) => ({ name: a.name_he || a.name_en, must: a.must_see === 1, cat: a.category }))),
      });
    }
    // AUDIENCE-IDENTITY CHECK: the family and couples builds should differ — if the
    // stop sets overlap ≥80% (Jaccard) the city has no audience signal (audience_fit
    // holes) and "מותאם לקהל" is an empty promise. Flag BOTH rows of this city.
    const fam = builtIds.families, adu = builtIds.adults;
    if (fam?.size && adu?.size) {
      const inter = [...fam].filter((x) => adu.has(x)).length;
      const jac = inter / (fam.size + adu.size - inter);
      if (jac >= 0.8) {
        const pct = Math.round(jac * 100);
        // Two different diseases, two different cures: a THIN pool (both audiences
        // take everything there is) needs content enrichment; a big pool building
        // identically needs audience_fit data. attractions is already the worthy
        // pool (topAttractions applies the content bar).
        const thin = attractions.length <= Math.max(fam.size, adu.size) * 1.4;
        const msg = thin
          ? `הטיול זהה לשני הקהלים (${pct}% חפיפה) — המאגר דק (${attractions.length} מקומות ראויים): להעשיר תוכן בעיר`
          : `הטיול זהה כמעט לגמרי לשני הקהלים (${pct}% חפיפה) — חסר סיגנל התאמת-קהל בעיר`;
        for (const row of report.slice(-2) as { issues: Issue[]; quality?: Quality }[]) {
          row.issues.push({ dim: "audienceIdentity", severity: "warn", msg });
          row.quality?.conformance.push({ ok: false, msg: thin
            ? `זהות בין קהלים (מאגר דק, ${attractions.length} ראויים) — נדרשת העשרת תוכן`
            : `זהות בין קהלים: ${pct}% חפיפה בין עם/בלי ילדים — להשלים audience_fit` });
        }
      }
    }
  }
  // A dead control is a flaw in EVERY trip, so it is priced into every trip's
  // score — the average the editor watches drops until it is fixed. Judged
  // globally (see globalControlVerdicts) and applied uniformly, so no single
  // thin city is punished for a wiring problem it did not cause.
  const controlsGlobal = globalControlVerdicts(
    report.map((r) => (r as { controls?: ControlResult[] }).controls ?? []));
  const ctrlPenalty = controlPenalty(controlsGlobal);
  if (ctrlPenalty > 0) {
    for (const r of report as { score: number; needsWork: boolean }[]) {
      r.score = Math.max(0, r.score - ctrlPenalty);
      r.needsWork = true;
    }
  }
  // summary
  const scores = report.map((r) => (r as { score: number }).score);
  const summary = {
    version: BRAIN_VERSION, trips: report.length,
    avgScore: scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0,
    needWork: report.filter((r) => (r as { needsWork: boolean }).needsWork).length,
    controls: controlsGlobal, controlPenalty: ctrlPenalty,
  };
  // Free-text quality report — the editor pastes this into chat for deep judgment + fixes.
  let qualityReport: string | undefined;
  if (b.quality) {
    const AUD: Record<string, string> = { families: "עם ילדים", adults: "בלי ילדים" };
    const L: string[] = [`בדיקת איכות · מוח ${BRAIN_VERSION}`, "═".repeat(34)];
    for (const r of report as ReportRow[]) {
      if (!r.quality) continue;
      L.push("", `▸ ${r.city} · ${AUD[r.audience] ?? r.audience} · ניקוד ${r.score}`);
      r.itinerary.days.forEach((d) => {
        const s = d.stops.filter((x) => x.kind !== "food").map((x) => x.name).join(" · ");
        L.push(`  ${d.label}${d.dayTrip ? " 🚗" : ""}: ${s}`);
      });
      L.push("  התאמה להגדרות (טכניקות):");
      r.quality.conformance.forEach((c) => L.push(`    ${c.ok ? "✓" : "✗"} ${c.msg}`));
      L.push("  מבחן ההנאה:");
      if (r.quality.fun.length) r.quality.fun.forEach((f) => L.push(`    ⚠️ ${f}`));
      else L.push("    ✓ לא נמצאו דגלי-שעמום (שיפוט ההנאה האמיתי — בצ'אט).");
      // The critic's flags (thin days, walkability, balance…) — everything the 🧠
      // table shows on the row. eveningEnd + audienceIdentity are skipped here
      // because the conformance section above already carries them as ✗ lines.
      const flags = r.issues.filter((i) => i.dim !== "eveningEnd" && i.dim !== "audienceIdentity");
      if (flags.length) {
        L.push("  דגלי המוח:");
        flags.forEach((i) => L.push(`    ${i.severity === "critical" ? "🔴" : "⚠️"} ${i.msg}`));
      }
      if (r.quality.suggestions.length) { L.push("  תובנות לשיפור:"); r.quality.suggestions.forEach((s) => L.push(`    • ${s}`)); }
    }
    // The controls verdict, once, at the end — it is a property of the ENGINE,
    // not of any one city.
    L.push("", "🎛️ בוררים — האם הם באמת משנים את הטיול?",
      "   (אותה עיר, אותו זרע, שדה אחד שונה. בורר שלא משנה כלום הוא הבטחה שלא מקיימים.)");
    for (const c of controlsGlobal) {
      L.push(c.skipped ? `   — ${c.he}: לא נבדק בערים שנסרקו`
        : c.live ? `   ✓ ${c.he}`
        : `   ❌ ${c.he} — ${c.why}`);
    }
    if (ctrlPenalty > 0) L.push(`   ↳ ${ctrlPenalty} נקודות ירדו מכל טיול בסריקה הזו.`);
    L.push("", "─".repeat(34),
      "הדבק דוח זה בצ'אט ל-Claude Code: (1) לשפוט האם הטיולים באמת מהנים (מעבר לבדיקה הדטרמיניסטית), (2) לגזור שיפורי-טכניקות/מנוע ולבצע.");
    qualityReport = L.join("\n");
  }
  return NextResponse.json({ summary, report, ...(qualityReport ? { qualityReport } : {}) });
}

type ReportRow = {
  city: string; audience: string; score: number;
  issues: { dim: string; severity: "critical" | "warn"; msg: string; day?: number }[];
  itinerary: { days: { label: string; dayTrip?: unknown; stops: { name: string; kind: string }[] }[] };
  quality?: Quality;
};
