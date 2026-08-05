import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { listDestinations, topAttractions, areasForDestination, brainRulesForDest, approvedStreetsForCity, type Attraction } from "@/lib/db";
import { annotateDaysWithAreas } from "@/lib/cluster";
import { buildCarBaseItinerary, buildHeuristicItinerary, streetAsStop } from "@/lib/heuristic";
import { qualityCheck, type Quality } from "@/lib/brain/quality";
import { critiqueTrip, type Issue } from "@/lib/brain/critique";
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
        // differentiation and blind the identity check.
        seed: id, varietyJitter: rules.varietyJitter,
        ...(!isFamily && eveningSpots.length ? { eveningSpots, eveningStartMin: rules.eveningStart } : {}) };
      // Build via the REAL consumer engine so the eval reflects exactly what a
      // traveller gets (dwell model, dedup, car day-trips) — one source of truth.
      const itinerary = carBase
        ? buildCarBaseItinerary(dest.city, dest.country, days, pool, center, isFamily, pace, 3, buildOpts)
        : buildHeuristicItinerary(dest.city, dest.country, days, pool, isFamily, pace, 3, undefined, buildOpts);
      annotateDaysWithAreas(itinerary.days, areas, center);
      // Reconstruct rich days (Attraction[][]) from the built trip → feed critique + quality.
      const byId = new Map(attractions.map((a) => [a.id, a]));
      const richDays: Attraction[][] = itinerary.days.map((d) =>
        d.stops.map((s) => (s.id != null ? byId.get(s.id) : undefined)).filter((a): a is Attraction => !!a));
      // Car-awareness for the critic: on a car_base trip EVERY day is driven; a
      // dayTrip is driven in any city. Long legs then read as נסיעה, not הליכה.
      // eveningEnd is read off the BUILT stop list (street stops are synthetic, so
      // richDays can't see them): the day's last real stop is an evening street.
      const dayMeta = itinerary.days.map((d) => {
        const real = d.stops.filter((s) => s.id != null);
        const lastId = real.length ? real[real.length - 1].id : null;
        return { car: carBase || !!d.dayTrip, eveningEnd: lastId != null && eveningIds.has(lastId) };
      });
      const crit = critiqueTrip(richDays, audience, { cityMustCount, rules, dayMeta, eveningCity: eveningSpots.length > 0 });
      const quality: Quality | undefined = b.quality ? qualityCheck(richDays, audience, rules, { cityMustCount,
        ...(eveningSpots.length ? { eveningEnds: dayMeta.map((m) => m.eveningEnd) } : {}) }) : undefined;
      builtIds[audience] = new Set(richDays.flat().map((a) => a.id));
      report.push({
        cityId: id, city: dest.city_he || dest.city, cityEn: dest.city, country: dest.country, audience, days,
        score: crit.score, needsWork: crit.needsWork, stops: crit.stops,
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
        for (const row of report.slice(-2) as { issues: Issue[]; quality?: Quality }[]) {
          row.issues.push({ dim: "audienceIdentity", severity: "warn",
            msg: `הטיול זהה כמעט לגמרי לשני הקהלים (${pct}% חפיפה) — חסר סיגנל התאמת-קהל בעיר` });
          row.quality?.conformance.push({ ok: false, msg: `זהות בין קהלים: ${pct}% חפיפה בין עם/בלי ילדים — להשלים audience_fit` });
        }
      }
    }
  }
  // summary
  const scores = report.map((r) => (r as { score: number }).score);
  const summary = {
    version: BRAIN_VERSION, trips: report.length,
    avgScore: scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0,
    needWork: report.filter((r) => (r as { needsWork: boolean }).needsWork).length,
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
      if (r.quality.suggestions.length) { L.push("  תובנות לשיפור:"); r.quality.suggestions.forEach((s) => L.push(`    • ${s}`)); }
    }
    L.push("", "─".repeat(34),
      "הדבק דוח זה בצ'אט ל-Claude Code: (1) לשפוט האם הטיולים באמת מהנים (מעבר לבדיקה הדטרמיניסטית), (2) לגזור שיפורי-טכניקות/מנוע ולבצע.");
    qualityReport = L.join("\n");
  }
  return NextResponse.json({ summary, report, ...(qualityReport ? { qualityReport } : {}) });
}

type ReportRow = {
  city: string; audience: string; score: number;
  itinerary: { days: { label: string; dayTrip?: unknown; stops: { name: string; kind: string }[] }[] };
  quality?: Quality;
};
