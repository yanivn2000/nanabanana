import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { listDestinations, topAttractions, areasForDestination, brainRulesForDest, type Attraction } from "@/lib/db";
import { clusterIntoDays, annotateDaysWithAreas } from "@/lib/cluster";
import { buildCarBaseItinerary } from "@/lib/heuristic";
import { splitByReach, clusterDayTrips, dayTripBudget } from "@/lib/daytrips";
import { durationHe } from "@/lib/geo";
import { isInSeason, stopMatchesType } from "@/lib/brain/traits";
import { critiqueTrip } from "@/lib/brain/critique";
import { BRAIN_VERSION, audienceFitScore, type Audience } from "@/lib/brain/policy";
import type { Itinerary, StopKind } from "@/lib/trip-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AUDIENCES: Audience[] = ["families", "adults"];
const SLOTS = ["09:30", "11:30", "14:30", "16:30", "18:00", "19:30"];
const KIND: Record<string, StopKind> = {
  nature: "nature", leisure: "nature", sport: "nature", museum: "culture", historic: "culture",
  attraction: "culture", tourism: "culture", food: "food", shopping: "shopping",
};

// Turn the Brain's clustered attractions into a real Itinerary (with coords) so the
// admin can open it as a full trip page — map, walking legs, area labels — which is
// the only way an editor who doesn't know the city can judge it.
function toItinerary(clustered: Attraction[][], dest: { city: string; city_he: string | null; country: string }, audience: Audience, days: number): Itinerary {
  return {
    title: `טיול ל${dest.city_he || dest.city}`,
    subtitle: `${days} ימים · ${audience}`,
    days: clustered.map((day, i) => ({
      label: `יום ${i + 1}`, date: "", base: dest.city_he || dest.city,
      stops: day.map((a, k) => ({
        name: a.name_he || a.name_en, kind: KIND[a.category] ?? "culture",
        time: SLOTS[Math.min(k, SLOTS.length - 1)],
        duration: durationHe(a.duration_minutes),
        id: a.id, lat: a.lat, lng: a.lng, image: a.image_url, tagline: a.tagline_he,
        score: audienceFitScore(a.audience_fit, audience), note: a.tips_he || a.tagline_he || undefined,
      })),
    })),
  };
}

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
    for (const audience of AUDIENCES) {
      // audience-ranked pool: must-sees first, then by this audience's fit. The
      // clusterer treats input order as value.
      const pool = [...attractions].sort((x: Attraction, y: Attraction) =>
        (y.must_see ?? 0) - (x.must_see ?? 0) ||
        (audienceFitScore(y.audience_fit, audience) - audienceFitScore(x.audience_fit, audience)));
      const center = { lat: dest.lat, lng: dest.lng };
      // car_base cities: critique only the WALKABLE in-city days (far day-trips are
      // driven, so walkability doesn't apply), but the trip page gets the full
      // itinerary incl. car day-trips so the editor can judge it on the map.
      const carBase = dest.mobility === "car_base";
      // apply the techniques to the pool so the critique matches the itinerary:
      // season filter + this audience's avoids (from the principles).
      const eligible = pool
        .filter((a) => rules.seasonFilter === false || isInSeason(a, month))
        .filter((a) => !(rules.avoid[audience] ?? []).some((t) => stopMatchesType(a, t)));
      const { inCity, far } = carBase ? splitByReach(eligible, center) : { inCity: eligible, far: [] as Attraction[] };
      const tripDays = carBase ? dayTripBudget(days, clusterDayTrips(far, center).length) : 0;
      const { days: built } = clusterIntoDays(inCity, days - tripDays, { walkPref: 3, dayMinutes: rules.paceStops[audience] * 84 });
      const crit = critiqueTrip(built, audience, { cityMustCount, rules });
      const buildOpts = { month, seasonFilter: rules.seasonFilter, dayEnderLast: rules.dayEnderLast, maxTypePerDay: rules.maxTypePerDay, avoidCats: rules.avoid[audience] ?? [] };
      const itinerary = carBase
        ? buildCarBaseItinerary(dest.city, dest.country, days, pool, center, audience === "families", rules.paceStops[audience], 3, buildOpts)
        : toItinerary(built, dest, audience, days);
      annotateDaysWithAreas(itinerary.days, areas, center);
      report.push({
        cityId: id, city: dest.city_he || dest.city, cityEn: dest.city, country: dest.country, audience, days,
        score: crit.score, needsWork: crit.needsWork, stops: crit.stops,
        dims: crit.dims, issues: crit.issues, itinerary,
        daysNames: built.map((d) => d.map((a) => ({ name: a.name_he || a.name_en, must: a.must_see === 1, cat: a.category }))),
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
