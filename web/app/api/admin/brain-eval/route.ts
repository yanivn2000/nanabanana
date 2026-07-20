import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { listDestinations, topAttractions, type Attraction } from "@/lib/db";
import { clusterIntoDays } from "@/lib/cluster";
import { critiqueTrip } from "@/lib/brain/critique";
import { BRAIN_VERSION, PACE_STOPS, type Audience } from "@/lib/brain/policy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AUDIENCES: Audience[] = ["families", "couples", "friends"];

// The Brain's self-evaluation: build a family/couples/friends trip for each city
// (deterministic — NO AI), critique each, and return a report. This is the
// "software test" loop — the report is what the editor reviews and what a Claude
// Code session reads to calibrate policy.ts.
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const days: number = b.days ?? 3;
  const dests = await listDestinations();
  const cityIds: number[] = Array.isArray(b.cities) && b.cities.length
    ? b.cities : dests.slice(0, 6).map((d) => d.id);

  const report: unknown[] = [];
  for (const id of cityIds) {
    const dest = dests.find((d) => d.id === id);
    if (!dest) continue;
    const attractions = await topAttractions(id, 150);
    const cityMustCount = attractions.filter((a) => a.must_see === 1).length;
    for (const audience of AUDIENCES) {
      // audience-ranked pool: must-sees first, then by this audience's fit. The
      // clusterer treats input order as value.
      const pool = [...attractions].sort((x: Attraction, y: Attraction) =>
        (y.must_see ?? 0) - (x.must_see ?? 0) ||
        ((y.audience_fit?.[audience] ?? 0) - (x.audience_fit?.[audience] ?? 0)));
      const { days: built } = clusterIntoDays(pool, days, { walkPref: 3, dayMinutes: PACE_STOPS[audience] * 84 });
      const crit = critiqueTrip(built, audience, { cityMustCount });
      report.push({
        cityId: id, city: dest.city_he || dest.city, audience,
        score: crit.score, needsWork: crit.needsWork, stops: crit.stops,
        dims: crit.dims, issues: crit.issues,
        days: built.map((d) => d.map((a) => ({ name: a.name_he || a.name_en, must: a.must_see === 1, cat: a.category }))),
      });
    }
  }
  // summary
  const scores = report.map((r) => (r as { score: number }).score);
  const summary = {
    version: BRAIN_VERSION, trips: report.length,
    avgScore: scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0,
    needWork: report.filter((r) => (r as { needsWork: boolean }).needsWork).length,
  };
  return NextResponse.json({ summary, report });
}
