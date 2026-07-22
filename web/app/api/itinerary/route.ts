import { NextRequest, NextResponse } from "next/server";
import { listDestinations, topAttractions, insightsForDestination, attractionsByIds, recordWalkEdges, areasForDestination, brainRulesForDest } from "@/lib/db";
import { annotateDaysWithAreas } from "@/lib/cluster";
import type { Attraction, Destination } from "@/lib/db";
import {
  aiConfigured,
  generateItinerary,
  generateMultiItinerary,
  reviseItinerary,
} from "@/lib/ai";
import { buildHeuristicItinerary, buildMultiHeuristicItinerary, buildCarBaseItinerary } from "@/lib/heuristic";
import { reviseHeuristic, arrangeDay } from "@/lib/revise-heuristic";
import { checkRateLimit } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import * as Sentry from "@sentry/nextjs";
import { paceToPerDay } from "@/lib/trip-types";
import { rankByTaste, tasteEmphasis } from "@/lib/taste";
import { haversineKm, estimateLeg } from "@/lib/geo";
import { reachPenalty } from "@/lib/brain/policy";
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
    mode: "generate" | "revise" | "details" | "arrange";
    city?: string;
    days?: number;
    month?: number;
    profileText?: string;
    hotels?: TripHotel[];
    current?: Itinerary;
    instruction?: string;
    dateContext?: string;
    // map "סדר את היום" — structured per-day rebuild (always deterministic, no AI).
    dayIndex?: number;
    addIds?: number[];
    removeIds?: number[];
    leftOut?: { id: number }[];   // details mode: re-attach coords to these
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
    // Chosen-neighbourhood tour: one member-id array per area the traveller picked
    // to tour. Present → build one guaranteed day per area (deterministic).
    areaGroups?: number[][];
    // Opt-in to the paid AI build. Default (false/undefined) = free instant
    // heuristic, so the paid API is never spent without the user asking (and can
    // be quota-gated later). revise always uses the AI (it's an AI edit).
    ai?: boolean;
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
  // The Brain's techniques (brain_principles) for this city — the builder obeys these.
  const rules = await brainRulesForDest(dest.id);
  // heuristic stops/day. Families get at least their pace-rule floor (fuller day).
  const perDay = isFamily ? Math.max(paceToPerDay(body.pace), rules.paceStops.families) : paceToPerDay(body.pace);
  // Base pool = top 150; then fold in the traveler's exact picks (even ones
  // ranked below 150) so a chosen place is always a real build candidate.
  const base = await topAttractions(dest.id, 150);
  const pickIds = body.selection ? [...body.selection.yes, ...body.selection.maybe] : [];
  const picks = pickIds.length ? await attractionsByIds(pickIds) : [];
  const seen = new Set(base.map((a) => a.id));
  const pool = [...base, ...picks.filter((p) => !seen.has(p.id))];
  // Wider pool (was 50) so the clusterer has a long tail of minor places to pull
  // in as "free gems" on the walking path (cluster.ts pass B).
  const rankedByTaste = rankByTaste(pool, body.taste, 90, isFamily);
  // Reach demotion (metro only): push far outliers (a 12km-away park) down the ranking
  // by ~penalty/8 positions, so walkable days don't sprawl. Mirrors the eval. car_base
  // is exempt — its far places become car day-trips. (See brain/policy#reachPenalty.)
  const attractions = dest.mobility === "car_base" ? rankedByTaste
    : rankedByTaste
        .map((a, i) => ({ a, k: i + (a.lat != null && a.lng != null ? reachPenalty(haversineKm(dest.lat, dest.lng, a.lat, a.lng), true) / 8 : 0) }))
        .sort((x, y) => x.k - y.k)
        .map((z) => z.a);
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
  // Neighbourhood layer (C): label each built day with its area + gateway.
  const areas = await areasForDestination(dest.id);
  // car_base cities (Salzburg, Brașov, islands…) get CAR day-trips to far worthy
  // clusters mixed with walkable in-city days; metros build in-city only.
  const buildOpts = {
    month: body.month, seasonFilter: rules.seasonFilter, dayEnderLast: rules.dayEnderLast,
    maxTypePerDay: rules.maxTypePerDay, avoidCats: isFamily ? rules.avoid.families : rules.avoid.adults,
    dayStartMin: rules.dayStartMin, lunchAfterMin: rules.lunchAfterMin, lunchMinutes: rules.lunchMinutes, dwell: rules.dwell,
    daytripThresholdKm: rules.daytripThresholdKm, daytripPerDays: rules.daytripPerDays, daytripMaxStops: rules.daytripMaxStops,
    samePlaceMeters: rules.samePlaceMeters, freeGemMaxPerDay: rules.freeGemMaxPerDay, freeGemDetourMin: rules.freeGemDetourMin,
  };
  const heuristicFor = (d: Destination, ndays: number, list: Attraction[], fam: boolean, pd: number, wp: number): Itinerary =>
    d.mobility === "car_base"
      ? buildCarBaseItinerary(d.city, d.country, ndays, list, { lat: d.lat, lng: d.lng }, fam, pd, wp, buildOpts)
      : buildHeuristicItinerary(d.city, d.country, ndays, list, fam, pd, wp, undefined, buildOpts);
  const respondGenerate = (itin: Itinerary, engine?: string) => {
    const scheduled = new Set<number>();
    const withDetails = attachDetails(itin, buildList, anchorIds, scheduled);
    recordTripEdges(dest, withDetails);
    annotateDaysWithAreas(withDetails.days, areas, { lat: dest.lat, lng: dest.lng });
    // car_base city → the whole trip is a rental-car trip; legs read as driving.
    if (dest.mobility === "car_base") withDetails.days.forEach((d) => { d.carBase = true; });
    const leftOut = body.selection
      ? picks.filter((a) => yesSet.has(a.id) && !scheduled.has(a.id))
          .map((a) => ({ id: a.id, name_he: a.name_he, name_en: a.name_en, image_url: a.image_url, category: a.category, lat: a.lat, lng: a.lng, tagline_he: a.tagline_he }))
      : [];
    return NextResponse.json({ itinerary: withDetails, ...(engine ? { engine } : {}), leftOut });
  };

  // Attach DB details to an existing itinerary — no AI, so it works without
  // credit and upgrades trips created before details existed.
  if (body.mode === "details") {
    if (!body.current) return NextResponse.json({ error: "missing current" }, { status: 400 });
    // Re-attach coords/tagline to left-out picks (older trips stored them without),
    // so the map can show them as grey markers.
    let leftOut: object[] | undefined;
    if (body.leftOut?.length) {
      const rows = await attractionsByIds(body.leftOut.map((l) => l.id));
      leftOut = rows.map((a) => ({ id: a.id, name_he: a.name_he, name_en: a.name_en, image_url: a.image_url, category: a.category, lat: a.lat, lng: a.lng, tagline_he: a.tagline_he }));
    }
    return NextResponse.json({ itinerary: attachDetails(body.current, pool), ...(leftOut ? { leftOut } : {}) });
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

    if (!body.ai || !aiConfigured()) {
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

  // Map "סדר את היום" — structured, always deterministic (never AI). Rebuilds one
  // day with the add/remove ids the user marked on the map.
  if (body.mode === "arrange") {
    if (!body.current || body.dayIndex == null) {
      return NextResponse.json({ error: "missing current/dayIndex" }, { status: 400 });
    }
    const r = arrangeDay(body.current, body.dayIndex, body.addIds ?? [], body.removeIds ?? [], attractions);
    return NextResponse.json({ itinerary: attachDetails(r.itinerary, attractions), engine: "heuristic" });
  }

  // Revise: DEFAULT is the deterministic engine (no Claude). The AI edit runs only
  // when AI is explicitly enabled (aiConfigured). Guarantees zero paid calls in prod.
  if (body.mode === "revise" && !aiConfigured()) {
    if (!body.current || !body.instruction) {
      return NextResponse.json({ error: "missing current/instruction" }, { status: 400 });
    }
    const r = reviseHeuristic(body.current, body.instruction, attractions);
    return NextResponse.json({ itinerary: attachDetails(r.itinerary, attractions), engine: "heuristic", ...(r.note ? { note: r.note } : {}) });
  }

  // Chosen-neighbourhood tour — DETERMINISTIC and must take priority: the traveller
  // picked areas, so build one guaranteed day per area (seedGroups). Placed BEFORE the
  // AI-vs-heuristic branching so it isn't swallowed by the no-AI generic fallback.
  if (body.mode !== "revise" && body.areaGroups?.length) {
    return respondGenerate(
      buildHeuristicItinerary(dest.city, dest.country, body.areaGroups.length, buildList,
        isFamily, perDay, body.walkPref ?? 3, body.areaGroups), "neighbourhoods");
  }

  // Generate works without a key via the heuristic builder; AI upgrades it.
  // buildList puts anchors first so the heuristic schedules them first too.
  if (body.mode !== "revise" && !aiConfigured()) {
    return respondGenerate(heuristicFor(dest, body.days ?? 4, buildList, isFamily, perDay, body.walkPref ?? 3), "heuristic");
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

  // DEFAULT: free, instant heuristic build (clustered days + distances + areas).
  // The paid AI is a separate opt-in upgrade (body.ai === true), so a build never
  // spends on the API without the user asking — the market-safe default.
  if (!body.ai) {
    return respondGenerate(heuristicFor(dest, body.days ?? 4, buildList, isFamily, perDay, body.walkPref ?? 3), "heuristic");
  }

  // AI upgrade: try Claude, but always fall back to the heuristic so the user
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
