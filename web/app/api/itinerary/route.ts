import { NextRequest, NextResponse } from "next/server";
import { listDestinations, topAttractions, insightsForDestination, attractionsByIds, recordWalkEdges } from "@/lib/db";
import type { Attraction, Destination } from "@/lib/db";
import {
  aiConfigured,
  generateItinerary,
  generateMultiItinerary,
  reviseItinerary,
} from "@/lib/ai";
import { buildHeuristicItinerary, buildMultiHeuristicItinerary } from "@/lib/heuristic";
import { checkRateLimit } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import * as Sentry from "@sentry/nextjs";
import { paceToPerDay } from "@/lib/trip-types";
import { rankByTaste, tasteEmphasis } from "@/lib/taste";
import { haversineKm, estimateLeg } from "@/lib/geo";
import type { Itinerary as ItineraryT } from "@/lib/trip-types";

// Record the walking bridges between consecutive located stops of a built trip,
// so the transport edge graph fills in from real builds (fire-and-forget — never
// blocks or fails the response). Deterministic haversine walk; transit later.
function recordTripEdges(dest: { id: number }, itin: ItineraryT): void {
  const legs: { from: number; to: number; walk_m: number; walk_min: number }[] = [];
  for (const day of itin.days) {
    const s = day.stops;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (!a.id || !b.id || a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
      const leg = estimateLeg(a.lat, a.lng, b.lat, b.lng);
      legs.push({ from: a.id, to: b.id, walk_m: leg.km * 1000, walk_min: leg.walkMin });
    }
  }
  if (legs.length) void recordWalkEdges(dest.id, legs).catch(() => {});
}
import type { TripHotel } from "@/lib/ai";
import type { Itinerary } from "@/lib/trip-types";

export const dynamic = "force-dynamic";
// A multi-day / multi-segment Claude build can take ~30-60s; without this Vercel
// would kill the function at its lower default and the build would 504.
export const maxDuration = 120;

// AI cost guard (P2). The generate/revise paths call Claude; details/heuristic
// don't. Two ceilings, both env-tunable without a redeploy:
//  - per-IP hourly: stops one abuser looping the builder.
//  - global daily: a hard circuit-breaker so a runaway can't exceed a known
//    daily spend. At 70% we log a warning (real alerting is P6/Sentry).
const AI_PER_IP_HOURLY = Number(process.env.AI_PER_IP_HOURLY ?? 15);
const AI_DAILY_CAP = Number(process.env.AI_DAILY_CAP ?? 500);

// Match by city name; otherwise (e.g. a hotel in a village we didn't ingest)
// pick the nearest ingested destination by coordinates.
async function resolveDestination(city?: string, lat?: number, lng?: number) {
  const dests = await listDestinations();
  if (dests.length === 0) return null;
  if (city) {
    const match = dests.find((d) => d.city.toLowerCase() === city.toLowerCase());
    if (match) return match;
  }
  if (lat != null && lng != null) {
    return dests
      .map((d) => ({ d, km: haversineKm(lat, lng, d.lat, d.lng) }))
      .sort((a, b) => a.km - b.km)[0].d;
  }
  return dests[0];
}

function normName(s: string): string {
  return s
    .replace(/\(.*?\)/g, "")
    .replace(/[^֐-׿\w ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Split the pool into the Explore selection's two tiers (F1). Anchors = the
// traveler's "כן" picks (or, if they chose none, the must-sees) so the day has a
// real centerpiece; fillers = everything else they didn't rule out ("לא").
function partitionBySelection(
  pool: Attraction[],
  taste: Record<string, number> | undefined,
  selection: { yes: number[]; maybe: number[]; no: number[] },
  isFamily: boolean
): { anchors: Attraction[]; fillers: Attraction[]; anchorIds: Set<number> } {
  const yes = new Set(selection.yes);
  const no = new Set(selection.no);
  const avail = pool.filter((a) => !no.has(a.id));
  let anchorPool = avail.filter((a) => yes.has(a.id));
  if (anchorPool.length === 0) anchorPool = avail.filter((a) => a.must_see === 1);
  const anchors = rankByTaste(anchorPool, taste, 30, isFamily);
  const anchorIds = new Set(anchors.map((a) => a.id));
  const fillers = rankByTaste(avail.filter((a) => !anchorIds.has(a.id)), taste, 40, isFamily);
  return { anchors, fillers, anchorIds };
}

// Match each itinerary stop back to its DB attraction and attach details
// (image, website, coords, tagline, time/dress/cost) for the expandable view.
// When anchorIds is given (Explore build), tag each matched stop as an anchor or
// an "אם יש זמן" filler so the trip page can show the two tiers.
function attachDetails(it: Itinerary, attractions: Attraction[], anchorIds?: Set<number>, scheduled?: Set<number>): Itinerary {
  const exact = new Map<string, Attraction>();
  const list: { a: Attraction; n: string }[] = [];
  for (const a of attractions) {
    for (const n of [a.name_he, a.name_en]) {
      const k = n ? normName(n) : "";
      if (k) { exact.set(k, a); list.push({ a, n: k }); }
    }
  }
  for (const day of it.days) {
    for (const s of day.stops) {
      const key = normName(s.name);
      if (!key) continue;
      let a = exact.get(key);
      if (!a) {
        a = list.find((x) => x.n.length >= 4 && (key.includes(x.n) || x.n.includes(key)))?.a;
      }
      if (a) {
        s.id = a.id;
        s.image = a.image_url; s.website = a.website;
        s.lat = a.lat; s.lng = a.lng;
        s.tagline = a.tagline_he; s.bestTime = a.best_time_he;
        s.dress = a.dress_he; s.cost = a.cost_level;
        if (anchorIds) s.anchor = anchorIds.has(a.id);
        scheduled?.add(a.id);
      }
    }
  }
  return it;
}

export async function POST(req: NextRequest) {
  let body: {
    mode: "generate" | "revise" | "details";
    city?: string;
    days?: number;
    month?: number;
    profileText?: string;
    hotels?: TripHotel[];
    current?: Itinerary;
    instruction?: string;
    dateContext?: string;
    taste?: Record<string, number>;
    segments?: { city: string; days: number; hotels?: TripHotel[] }[];
    // Explore build (F1): the traveler's per-trip picks. Drives an anchors-first,
    // "אם יש זמן" fillers plan on the single-city generate path.
    selection?: { yes: number[]; maybe: number[]; no: number[] };
    // Only when there are kids: apply the family-friendliness lens (family_score
    // ranking). Adults-only trips (couple/friends) rank by taste + must-see only.
    isFamily?: boolean;
    // Trip pace → meaningful stops/day for the heuristic builder (matches the
    // city page's capacity promise). AI path reads pace from profileText.
    pace?: string;
    // How far the traveler will walk between stops (1-5) → tunes the proximity
    // clustering: bigger = looser, larger days; smaller = tighter clusters.
    walkPref?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Cost guard — only the AI-spending modes (details/heuristic are free).
  if ((body.mode === "generate" || body.mode === "revise") && aiConfigured()) {
    const ipLimited = await rateLimit(req, "itinerary", AI_PER_IP_HOURLY, 3600);
    if (ipLimited) return ipLimited;
    const daily = await checkRateLimit("ai:builds:daily", AI_DAILY_CAP, 86_400);
    if (!daily.ok) {
      return NextResponse.json(
        { error: "ai_daily_cap", message: "בונה הטיולים עמוס כרגע — נסו שוב מאוחר יותר." },
        { status: 429, headers: { "Retry-After": "3600" } });
    }
    if (daily.count === Math.floor(AI_DAILY_CAP * 0.7)) {
      const msg = `[ai-budget] daily builds at ${daily.count}/${AI_DAILY_CAP} (70%)`;
      console.warn(msg);
      Sentry.captureMessage(msg, "warning"); // alert while there's still headroom
    }
  }

  const near = body.hotels?.[0];
  const dest = await resolveDestination(body.city, near?.lat, near?.lng);
  if (!dest) {
    return NextResponse.json({ error: "no destinations in DB" }, { status: 404 });
  }
  // Broad candidate pool, then narrow to the group's TASTE (#63): a music/
  // vintage couple and a sports/history couple get different attraction sets
  // fed to the builder → genuinely different trips. No taste → family order.
  const isFamily = body.isFamily === true;
  const perDay = paceToPerDay(body.pace);   // heuristic stops/day, matches the pace promise
  // Base pool = top 150; then fold in the traveler's exact picks (even ones
  // ranked below 150) so a chosen place is always a real build candidate.
  const base = await topAttractions(dest.id, 150);
  const pickIds = body.selection ? [...body.selection.yes, ...body.selection.maybe] : [];
  const picks = pickIds.length ? await attractionsByIds(pickIds) : [];
  const seen = new Set(base.map((a) => a.id));
  const pool = [...base, ...picks.filter((p) => !seen.has(p.id))];
  // Wider pool (was 50) so the clusterer has a long tail of minor places to pull
  // in as "free gems" on the walking path (cluster.ts pass B).
  const attractions = rankByTaste(pool, body.taste, 90, isFamily);
  // Explore build (F1): split into anchors + "אם יש זמן" fillers. Only used by
  // the single-city generate path below (details/revise/multi ignore it).
  const sel = body.selection ? partitionBySelection(pool, body.taste, body.selection, isFamily) : null;
  const buildList = sel ? [...sel.anchors, ...sel.fillers] : attractions;
  // Only tag tiers when there's a real anchor set — otherwise every stop would
  // read "אם יש זמן" (e.g. a click-through selection with no picks / no must-sees).
  const anchorIds = sel && sel.anchors.length ? sel.anchorIds : undefined;

  // Attach details, then report the traveler's "כן" picks that did NOT make it
  // into the plan (too many for the days, or squeezed out) so the trip page can
  // offer to add them back. Empty unless this was a real selection build.
  const yesSet = new Set(body.selection?.yes ?? []);
  const respondGenerate = (itin: Itinerary, engine?: string) => {
    const scheduled = new Set<number>();
    const withDetails = attachDetails(itin, buildList, anchorIds, scheduled);
    recordTripEdges(dest, withDetails);
    const leftOut = body.selection
      ? picks.filter((a) => yesSet.has(a.id) && !scheduled.has(a.id))
          .map((a) => ({ id: a.id, name_he: a.name_he, name_en: a.name_en, image_url: a.image_url, category: a.category }))
      : [];
    return NextResponse.json({ itinerary: withDetails, ...(engine ? { engine } : {}), leftOut });
  };

  // Attach DB details to an existing itinerary — no AI, so it works without
  // credit and upgrades trips created before details existed.
  if (body.mode === "details") {
    if (!body.current) return NextResponse.json({ error: "missing current" }, { status: 400 });
    return NextResponse.json({ itinerary: attachDetails(body.current, pool) });
  }

  // Multi-city trip: one continuous itinerary across ordered segments, each
  // built from its own city's attraction pool.
  if (body.mode !== "revise" && body.segments && body.segments.length > 1) {
    const resolved = await Promise.all(
      body.segments.map(async (s) => {
        const d = await resolveDestination(s.city);
        return d ? { dest: d as Destination, days: s.days, hotels: s.hotels } : null;
      }));
    const segs = resolved.filter(
      (x): x is { dest: Destination; days: number; hotels: TripHotel[] | undefined } => x !== null);
    const segAttrs = await Promise.all(
      segs.map(async (x) => ({
        ...x,
        attractions: rankByTaste(await topAttractions(x.dest.id, 150), body.taste, 90, isFamily),
        insights: await insightsForDestination(x.dest.id),
      })));
    const allAttractions = segAttrs.flatMap((x) => x.attractions);
    const heuristic = () => attachDetails(
      buildMultiHeuristicItinerary(segAttrs.map((x) => ({
        city: x.dest.city, country: x.dest.country, days: x.days, attractions: x.attractions,
      })), isFamily, perDay, body.walkPref ?? 3), allAttractions);

    if (!aiConfigured()) {
      return NextResponse.json({ itinerary: heuristic(), engine: "heuristic" });
    }
    try {
      const itinerary = await generateMultiItinerary({
        segments: segAttrs.map((x) => ({
          city: x.dest.city, country: x.dest.country, days: x.days,
          attractions: x.attractions, hotels: x.hotels, insights: x.insights,
        })),
        month: body.month,
        profileText: body.profileText ?? "מטיילים · קצב רגוע",
        emphasis: tasteEmphasis(body.taste),
        isFamily,
      });
      return NextResponse.json({ itinerary: attachDetails(itinerary, allAttractions) });
    } catch (e) {
      console.warn(`[itinerary] multi AI failed, heuristic: ${(e as Error).message}`);
      return NextResponse.json({ itinerary: heuristic(), engine: "heuristic" });
    }
  }

  // Revise needs the model. Without a key, ask the user to add one.
  if (body.mode === "revise" && !aiConfigured()) {
    return NextResponse.json({ error: "AI not configured", code: "no_key" }, { status: 503 });
  }

  // Generate works without a key via the heuristic builder; AI upgrades it.
  // buildList puts anchors first so the heuristic schedules them first too.
  if (body.mode !== "revise" && !aiConfigured()) {
    return respondGenerate(
      buildHeuristicItinerary(dest.city, dest.country, body.days ?? 4, buildList, isFamily, perDay, body.walkPref ?? 3), "heuristic");
  }

  if (body.mode === "revise") {
    if (!body.current || !body.instruction) {
      return NextResponse.json({ error: "missing current/instruction" }, { status: 400 });
    }
    try {
      const itinerary = await reviseItinerary(
        body.current, body.instruction, attractions, body.profileText, body.dateContext
      );
      return NextResponse.json({ itinerary: attachDetails(itinerary, attractions) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = /credit balance/i.test(msg) ? "no_credit" : undefined;
      return NextResponse.json({ error: msg, code }, { status: 500 });
    }
  }

  // Generate: try Claude, but always fall back to the heuristic so the user
  // gets an itinerary even if Claude errors (e.g. no credit / rate limit).
  try {
    const itinerary = await generateItinerary({
      city: dest.city,
      country: dest.country,
      days: body.days ?? 4,
      month: body.month,
      profileText: body.profileText ?? "מטיילים · קצב רגוע",
      attractions: buildList,
      hotels: body.hotels,
      insights: await insightsForDestination(dest.id),
      emphasis: tasteEmphasis(body.taste),
      anchors: sel?.anchors,
      fillers: sel?.fillers,
      isFamily,
      walkPref: body.walkPref ?? 3,
    });
    return respondGenerate(itinerary);
  } catch (e) {
    console.warn(`[itinerary] AI generate failed, using heuristic: ${(e as Error).message}`);
    return respondGenerate(
      buildHeuristicItinerary(dest.city, dest.country, body.days ?? 4, buildList, isFamily, perDay, body.walkPref ?? 3), "heuristic");
  }
}
