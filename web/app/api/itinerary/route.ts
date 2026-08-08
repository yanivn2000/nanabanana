import { NextRequest, NextResponse } from "next/server";
import { listDestinations, topAttractions, insightsForDestination, attractionsByIds, childrenOfParents, recordWalkEdges, areasForDestination, brainRulesForDest, streetsByIds, approvedStreetsForCity, nightPassbyForCity } from "@/lib/db";
import { annotateDaysWithAreas } from "@/lib/cluster";
import type { Attraction, Destination } from "@/lib/db";
import { refOf, synthId, isRealAttraction, idKind } from "@/lib/place";
import { wikiUrl, mergeCat } from "@/lib/labels";
import {
  aiConfigured,
  generateItinerary,
  generateMultiItinerary,
  reviseItinerary,
} from "@/lib/ai";
import { buildHeuristicItinerary, buildMultiHeuristicItinerary, buildCarBaseItinerary, streetAsStop } from "@/lib/heuristic";
import { reviseHeuristic, arrangeDay } from "@/lib/revise-heuristic";
import { checkRateLimit } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import * as Sentry from "@sentry/nextjs";
import { paceBudget } from "@/lib/trip-types";
import { rankByTaste, tasteEmphasis } from "@/lib/taste";
import { haversineKm, estimateLeg } from "@/lib/geo";
import { reachPenalty } from "@/lib/brain/policy";
import { critiqueTrip } from "@/lib/brain/critique";
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
      // attraction_edges' FK is to attractions — never record a synthetic stop
      // (a street) as an endpoint.
      if (!a.id || !b.id || !isRealAttraction(a.id) || !isRealAttraction(b.id)
          || a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
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
// How many usable places a day of trip needs before the pool is considered
// sufficient. Below days × this, topAttractions tops up with tier-2 fillers.
const POOL_PER_DAY = 7;
const AI_PER_IP_HOURLY = Number(process.env.AI_PER_IP_HOURLY ?? 15);
const AI_DAILY_CAP = Number(process.env.AI_DAILY_CAP ?? 500);

// Match by city name; otherwise (e.g. a hotel in a village we didn't ingest)
// pick the nearest ingested destination by coordinates.
async function resolveDestination(city?: string, lat?: number, lng?: number) {
  const dests = await listDestinations();
  if (dests.length === 0) return null;
  if (city) {
    const c = city.toLowerCase().trim();
    // Exact on the English city, then the Hebrew city, then a contains-match either
    // way ("London" ↔ "Greater London") — so a slightly-off name never silently
    // falls through to the WRONG city (dests[0]) and builds someone else's trip.
    const match = dests.find((d) => d.city.toLowerCase() === c)
      || dests.find((d) => (d.city_he ?? "").toLowerCase() === c)
      || dests.find((d) => { const dc = d.city.toLowerCase(); return dc.includes(c) || c.includes(dc); });
    if (match) return match;
  }
  if (lat != null && lng != null) {
    return dests
      .map((d) => ({ d, km: haversineKm(lat, lng, d.lat, d.lng) }))
      .sort((a, b) => a.km - b.km)[0].d;
  }
  // A named-but-unmatched city with no coords is a caller bug — don't silently
  // build the top-ranked city's trip; surface it.
  return city ? null : dests[0];
}

function normName(s: string): string {
  return s
    .replace(/\(.*?\)/g, "")
    .replace(/[^֐-׿\w ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Reorder a ranked list into ROUND-ROBIN order over broad type (mergeCat on
// category): one of each type, then a second of each, and so on. Buckets keep
// the incoming (taste) order internally, and the bucket rotation follows each
// type's first (best-ranked) appearance. Result: when the traveler picks more
// than the trip can hold, the first `capacity` that the clusterer keeps are a
// spread across types (museum + food + park + …) instead of, say, five museums;
// the overflow trails and falls through to the bank downstream. No effect when
// everything fits (all picks are kept regardless of order).
function roundRobinByType(items: Attraction[]): Attraction[] {
  const buckets: Attraction[][] = [];
  const byKey = new Map<string, Attraction[]>();
  for (const a of items) {
    const k = mergeCat(a.category || "attraction");
    let b = byKey.get(k);
    if (!b) { b = []; byKey.set(k, b); buckets.push(b); }
    b.push(a);
  }
  const out: Attraction[] = [];
  for (let round = 0; out.length < items.length; round++)
    for (const b of buckets) if (round < b.length) out.push(b[round]);
  return out;
}

// Split the pool into the Explore selection's two tiers (F1). Anchors = the
// traveler's "כן" picks (or, if they chose none, the must-sees) so the day has a
// real centerpiece; fillers = everything else they didn't rule out ("לא").
function partitionBySelection(
  pool: Attraction[],
  taste: Record<string, number> | undefined,
  selection: { yes: number[]; no: number[] },
  isFamily: boolean,
  strict = false,
  capacity = 0
): { anchors: Attraction[]; fillers: Attraction[]; anchorIds: Set<number> } {
  const yes = new Set(selection.yes);
  const no = new Set(selection.no);
  const avail = pool.filter((a) => !no.has(a.id));
  let anchorPool = avail.filter((a) => yes.has(a.id));
  if (anchorPool.length === 0) anchorPool = avail.filter((a) => a.must_see === 1);
  const ranked = rankByTaste(anchorPool, taste, strict ? 200 : 30, isFamily);
  // WYSIWYG picks: spread the kept attractions across types (round-robin) so an
  // over-picked trip fills with variety and the rest go to the bank. Legacy
  // explore keeps the plain taste order.
  const anchors = strict ? roundRobinByType(ranked) : ranked;
  const anchorIds = new Set(anchors.map((a) => a.id));
  // The ❤ picks are MANDATORY (guaranteed into the days downstream, never banked).
  // Fillers only TOP UP the remaining capacity so a traveller who picked 3 places
  // for a 4-day trip still gets a full plan — the system completes the rest with
  // the city's must-sees and best-ranked places. Under-picking is normal, not an
  // error; over-picking still needs no filler (capacity already spent).
  // "לא" places never return, so un-liking a must-see still removes it for good.
  const room = strict ? Math.max(0, capacity - anchors.length) : 40;
  const fillerPool = avail.filter((a) => !anchorIds.has(a.id));
  let fillers: Attraction[] = [];
  if (room > 0) {
    if (strict) {
      // Rank by taste first, THEN float must-sees up (a stable partition — ranking
      // last would bury the icons). A thin city may not have enough must-sees to
      // fill the days, so the best of the rest follows.
      const ranked2 = rankByTaste(fillerPool, taste, Math.max(60, room * 3), isFamily);
      fillers = [...ranked2.filter((a) => a.must_see === 1), ...ranked2.filter((a) => a.must_see !== 1)]
        .slice(0, room + 6);   // a little slack so the clusterer can choose by geography
    } else {
      fillers = rankByTaste(fillerPool.filter((a) => a.must_see === 1), taste, 40, isFamily);
    }
  }
  return { anchors, fillers, anchorIds };
}


// streetAsStop moved to lib/heuristic.ts so the Brain eval can build with the
// evening street layer through the same conversion.

// Match each itinerary stop back to its DB attraction and attach details
// (image, website, coords, tagline, time/dress/cost) for the expandable view.
// When anchorIds is given (Explore build), tag each matched stop as an anchor or
// an "אם יש זמן" filler so the trip page can show the two tiers.
function attachDetails(it: Itinerary, attractions: Attraction[], anchorIds?: Set<number>, scheduled?: Set<number>): Itinerary {
  const exact = new Map<string, Attraction>();
  const byId = new Map<number, Attraction>();
  const list: { a: Attraction; n: string }[] = [];
  for (const a of attractions) {
    byId.set(a.id, a);
    for (const n of [a.name_he, a.name_en]) {
      const k = n ? normName(n) : "";
      if (k) { exact.set(k, a); list.push({ a, n: k }); }
    }
  }
  for (const day of it.days) {
    for (const s of day.stops) {
      if (s.manual) continue;   // traveller-added place — keep as-is, never re-match to the pool
      const key = normName(s.name);
      if (!key) continue;
      // A stop that already knows its own id IS that place — match by id, never
      // by name. The substring fallback below is for stops that arrive without
      // one (a saved module), and it is loose enough to be dangerous: it gave
      // "תצפית גשר קארל והטירה" the id of "גשר קארל" (the name contains it) and
      // "קובנט גארדן" the id of "שוק קובנט גארדן", so two distinct places became
      // one everywhere downstream — map pin, bank, dedupe, usedIds.
      let a = s.id != null ? byId.get(s.id) : undefined;
      // A street/zone stop is a place in its own right: the builder already gave
      // it a synthetic id, image, tagline and geometry. Nothing to re-match.
      if (!a && s.id != null && idKind(s.id) !== "attr") continue;
      if (!a) a = exact.get(key);
      if (!a && s.id == null) {
        a = list.find((x) => x.n.length >= 4 && (key.includes(x.n) || x.n.includes(key)))?.a;
      }
      if (a) {
        s.id = a.id;
        s.nameEn = a.name_en;
        s.image = a.image_url; s.website = a.website;
        // A builder-trimmed street carries its own (trimmed) path + centroid;
        // don't clobber it with the full-street geometry from the pool.
        if (!s.path) { s.lat = a.lat; s.lng = a.lng; }
        s.tagline = a.tagline_he; s.description = a.description_he; s.bestTime = a.best_time_he;
        s.wiki = wikiUrl(a.info_sources);
        s.dress = a.dress_he; s.cost = a.cost_level;
        s.cat = a.category; s.sub = a.subcategory;
        s.parentId = a.parent_id ?? null; s.passbyMinutes = a.passby_minutes ?? null;
        // Only fill it in — the builder already set the right value, and the
        // name match above is fuzzy enough to hit "שוק קובנט גארדן" from the
        // curated evening street "קובנט גארדן".
        if (s.timeOfDay == null) s.timeOfDay = a.time_of_day ?? null;
        s.ref = a.ref ?? refOf("attr", a.id);
        if (a.path && !s.path) s.path = a.path;
        if (anchorIds) s.anchor = anchorIds.has(a.id);
        scheduled?.add(a.id);
      }
    }
  }
  return it;
}

export async function POST(req: NextRequest) {
  let body: {
    mode: "generate" | "revise" | "details" | "arrange" | "suggest";
    city?: string;
    days?: number;
    month?: number;
    profileText?: string;
    driveHours?: number;   // cap for car day-trips (the distance slider)
    hotels?: TripHotel[];
    current?: Itinerary;
    instruction?: string;
    dateContext?: string;
    // map "סדר את היום" — structured per-day rebuild (always deterministic, no AI).
    dayIndex?: number;
    addIds?: number[];
    removeIds?: number[];
    // "suggest" mode — profile-fitting attractions for the city NOT already used,
    // to top up the "more attractions" bank when it's empty.
    usedIds?: number[];
    leftOut?: { id: number }[];   // details mode: re-attach coords to these
    taste?: Record<string, number>;
    // Chosen interest chip keys (GOVERNING_INTERESTS) — enable the coarse category
    // fallback in ranking (for untagged places) and the theme reservation below.
    // Who the trip is for ("adults" = couples/friends) — folds audience_fit into the
    // ranking so the build is audience-appropriate without a frozen curated selection.
    audience?: "families" | "adults";
    segments?: { city: string; days: number; hotels?: TripHotel[] }[];
    // Explore build (F1): the traveler's per-trip picks. Drives an anchors-first,
    // "אם יש זמן" fillers plan on the single-city generate path.
    selection?: { yes: number[]; no: number[] };
    streetIds?: number[];   // recommended streets the traveller marked "כן"
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
    areaIds?: number[];    // chosen area ids, parallel to areaGroups (so a street maps to its area's day)
    // Opt-in to the paid AI build. Default (false/undefined) = free instant
    // heuristic, so the paid API is never spent without the user asking (and can
    // be quota-gated later). revise always uses the AI (it's an AI edit).
    ai?: boolean;
    seed?: number;   // exact-reproduction seed for the variety layer (absent = fresh random)
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Load guard for EVERY build, AI or not. "Free" heuristic builds are free in
  // dollars, not in compute: each one pulls the city pool and scores 5 candidate
  // itineraries, and with AI off for launch the old aiConfigured() condition
  // left this endpoint entirely unthrottled. Two windows, both owner-set
  // ("תוריד ל 20 ו 50 ביום שלא יגנבו לנו דאטה"): 20/hour absorbs a real planning
  // session with re-builds to spare, and 50/day is the scraper wall — a full
  // build returns an itinerary plus the ranked bank, which is exactly the
  // curated data someone would farm. Note: only generate/revise. The cheap
  // trip-page modes (arrange, suggest, details) stay unthrottled so editing a
  // day never hits a wall.
  // A request with NO mode falls through to a full generate — that default is
  // what a naive scraper sends, so it must be inside the throttle, not outside
  // it. Only the explicitly-cheap trip-page modes are exempt.
  const CHEAP_MODES = new Set(["details", "arrange", "suggest"]);
  if (!CHEAP_MODES.has(body.mode as string)) {
    const buildLimited = await rateLimit(req, "build", 20, 3600)
      ?? await rateLimit(req, "build-daily", 50, 86_400);
    if (buildLimited) return buildLimited;
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
  // The "משפחות" audience chip alone (not only a kids-in-profile flag) drives the
  // family build path: family-friendly ranking of the FILL, so a family trip skews
  // to places kids enjoy while the shared must-see icons stay in for everyone.
  const isFamily = body.isFamily === true || body.audience === "families";
  // The Brain's techniques (brain_principles) for this city — the builder obeys these.
  const rules = await brainRulesForDest(dest.id);
  // heuristic stops/day. Families get at least their pace-rule floor (fuller day).
  // Day shape: fill by TIME up to dinner (paceBudget), not by a stop count — a
  // drive-by landmark and a three-hour museum are not each "one attraction".
  // perDay survives only as a runaway guard on how many stops a day may hold.
  const pace = paceBudget(body.pace);
  const perDay = isFamily ? Math.max(pace.maxStops, rules.paceStops.families) : pace.maxStops;
  // Base pool = top 150; then fold in the traveler's exact picks AND the members of
  // any chosen neighbourhoods (even ones ranked below 150) so a chosen place / area
  // member is always a real build candidate.
  // minPool: what THIS trip needs (~7 usable places a day). Below it, the pool
  // is topped up with tier-2 fillers — see topAttractions.
  const base = await topAttractions(dest.id, 150, (body.days ?? 4) * POOL_PER_DAY);
  const pickIds = body.selection ? [...body.selection.yes] : [];
  const picks = pickIds.length ? await attractionsByIds(pickIds) : [];
  // Layer 2 (additive areas): the members of chosen neighbourhoods. They no longer
  // define the DAYS (one-day-per-area) — they're reserved into the interest-governed
  // build so the clusterer composes them into day-PARTS by proximity (area A morning,
  // area B / centre afternoon), keeping the traveller's own day count.
  const noSet0 = new Set(body.selection?.no ?? []);
  const areaMemberIds = body.areaGroups?.length
    ? [...new Set(body.areaGroups.flat())].filter((id): id is number => typeof id === "number" && !noSet0.has(id))
    : [];
  const areaMemberRows = areaMemberIds.length ? await attractionsByIds(areaMemberIds) : [];
  const seen = new Set(base.map((a) => a.id));
  let pool = [...base, ...[...picks, ...areaMemberRows].filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })];
  const audience = body.audience === "families" || body.audience === "adults" ? body.audience : undefined;
  // A couples/friends trip should NOT include clearly kid-only places — a theme park /
  // zoo / aquarium / water-park, or a heavily family-skewed audience_fit (families ≫
  // couples). These are FAMILY must-sees, not adults ones, so drop them from an adults
  // build — unless the traveller explicitly picked the place or chose the kids/amusement
  // theme. (Families keep them via the family_score sort.)
  const KID_SUBS = new Set(["theme_park", "water_park", "playground", "zoo", "aquarium"]);
  const isKidOnly = (a: Attraction) => {
    if (a.subcategory && KID_SUBS.has(a.subcategory)) return true;
    const af = a.audience_fit as { couples?: number; friends?: number; families?: number } | null;
    if (!af) return false;
    const fam = af.families ?? 0, adu = Math.max(af.couples ?? 0, af.friends ?? 0);
    return fam >= 75 && fam - adu >= 30;
  };
  if (audience === "adults") {
    pool = pool.filter((a) => pickIds.includes(a.id) || !isKidOnly(a));
  }
  // Wider pool (was 50) so the clusterer has a long tail of minor places to pull
  // in as "free gems" on the walking path (cluster.ts pass B).
  const rankedByTaste = rankByTaste(pool, body.taste, 90, isFamily, [], audience);
  // Reach demotion (metro only): push far outliers (a 12km-away park) down the ranking
  // by ~penalty/8 positions, so walkable days don't sprawl. Mirrors the eval. car_base
  // is exempt — its far places become car day-trips. (See brain/policy#reachPenalty.)
  // A hard radius guard first DROPS the truly unreachable (e.g. Kröller-Müller ~65km,
  // mis-catalogued to Amsterdam) from a metro walking trip — a metro day can't reach it
  // and it otherwise ate a whole day. User's explicit picks are exempt.
  const METRO_MAX_KM = 35;
  const rankedReach = dest.mobility === "car_base" ? rankedByTaste
    : rankedByTaste
        .filter((a) => a.lat == null || a.lng == null || pickIds.includes(a.id) || haversineKm(dest.lat, dest.lng, a.lat, a.lng) <= METRO_MAX_KM)
        .map((a, i) => ({ a, k: i + (a.lat != null && a.lng != null ? reachPenalty(haversineKm(dest.lat, dest.lng, a.lat, a.lng), true) / 8 : 0) }))
        .sort((x, y) => x.k - y.k)
        .map((z) => z.a);
  // Chosen-area members are guaranteed candidates even past the 90-cap / reach filter
  // (the reservation front-loads them regardless of their rank position here).
  // Chosen-area members AND the traveller's explicit ❤ picks are guaranteed
  // candidates even past the 90-cap / reach filter (the reservation front-loads
  // them regardless of rank position). Deduped, coords required.
  const haveA = new Set(rankedReach.map((a) => a.id));
  const guaranteedExtra: Attraction[] = [];
  for (const a of [...areaMemberRows, ...picks]) {
    if (a.lat == null || a.lng == null || haveA.has(a.id)) continue;
    haveA.add(a.id); guaranteedExtra.push(a);
  }
  const attractions = guaranteedExtra.length ? [...rankedReach, ...guaranteedExtra] : rankedReach;
  // Explore build (F1): split into anchors + "אם יש זמן" fillers. Only used by
  // the single-city generate path below (details/revise/multi ignore it).
  // ❤ likes are ADDITIVE refinements when the funnel is driving (an audience or
  // neighbourhoods were chosen): keep the interest/audience-governed path and fold
  // the picks into its reservation (guaranteed in, museum-cap-exempt) rather than
  // handing the whole build to the marks. Only a PURE explore build (no audience,
  // no areas) lets the marks drive everything via partitionBySelection.
  const governed = !!audience || areaMemberIds.length > 0;
  // WYSIWYG: once the traveller has ❤ marks (the pre-marked set they curated on the
  // destination page), OBEY them exactly — build ONLY from the marks, no auto-fill,
  // even with an audience/areas. So removing a mark (incl. a must-see) removes it, and
  // nothing un-marked enters. `attractions` (not `pool`) so interest/area picks past the
  // top pool are found. Falls back to the governed reservation only if there are no marks.
  const hasMarks = (body.selection?.yes?.length ?? 0) > 0;
  // Trip capacity = days × pace. Picks fill it; the system tops up the remainder,
  // so "בנו לי טיול" works from the very first pick (or none at all).
  const selCapacity = (body.days ?? 4) * perDay;
  const sel = body.selection && (hasMarks || !governed)
    ? partitionBySelection(hasMarks ? attractions : pool, body.taste, body.selection, isFamily, hasMarks, selCapacity)
    : null;
  // Streets the traveller picked lead the build list, so the clusterer treats
  // them as the day's top candidates (they were an explicit "כן").
  const streetRows = Array.isArray(body.streetIds) && body.streetIds.length
    ? await streetsByIds(body.streetIds.filter((n) => typeof n === "number")) : [];
  // A chosen neighbourhood auto-pulls its own streets — "I'm already in the area, of
  // course I'll walk its main streets". Deduped against any legacy body.streetIds.
  const chosenAreaIds = Array.isArray(body.areaIds) ? body.areaIds.filter((n): n is number => typeof n === "number") : [];
  if (chosenAreaIds.length) {
    const allStreets = await approvedStreetsForCity(dest.id);
    const have = new Set(streetRows.map((s) => s.id));
    const add: typeof allStreets = [];
    for (const s of allStreets) if (s.area_id != null && chosenAreaIds.includes(s.area_id) && !have.has(s.id)) { have.add(s.id); add.push(s); }
    streetRows.push(...add);
  }
  // A parent in the pool drags its sub-attractions in, whatever their own rank —
  // otherwise half a complex is simply missing from the trip.
  {
    const parentIds = attractions.filter((a) => a.parent_id == null).map((a) => a.id);
    const have = new Set(attractions.map((a) => a.id));
    const kids = (await childrenOfParents(parentIds)).filter((k) => !have.has(k.id));
    if (kids.length) attractions.push(...kids);
  }
  const streetStops = streetRows.map(streetAsStop);
  // Interest-governed reservation (single-city, no explicit selection): guarantee
  // the city's key must-sees (~1 hero/day) AND ≥K stops per chosen interest survive
  // the top-90 + candidate-window cuts — so a "loves markets" trip actually gets
  // markets and keeps the icons, while the interest-ranked majority fills the rest.
  // Front-loading into buildList is the one place that beats BOTH cuts (mirrors the
  // streetStops prepend). Gated to !sel — the selection path already guarantees
  // must-sees via its fillers, so it's left untouched.
  let reservedIds: Set<number> | undefined;
  let orderedFill: Attraction[] = attractions;
  if (!sel) {
    const rDays = body.days ?? 4;
    const RESERVE_ICONS = Math.max(3, rDays);
    // Pick-driven build: no interests are chosen, so nothing is "chosen" category-wise
    // — the diversity floor covers all majors and the balance caps treat every
    // category evenly.
    const chosenCats = new Set<string>();
    const catBucket = (a: Attraction) => (a.category === "tourism" ? "historic" : (a.category ?? "attraction"));
    const inRange = new Set(attractions.map((a) => a.id));
    const chosen = new Set<number>();
    const reserved: Attraction[] = [];
    // Explicit ❤ likes lead the reservation — a refinement the traveller made ON
    // the governed build, so it's guaranteed in (and museum-cap-exempt below).
    const pickSet = new Set(pickIds);
    for (const a of attractions.filter((x) => pickSet.has(x.id))) {
      if (!chosen.has(a.id)) { chosen.add(a.id); reserved.push(a); }
    }
    // Icons from DB icon order (`base`, EDITOR_ORDER: must-see first), NOT the
    // taste-sorted list — so the city's defining must-sees are guaranteed regardless
    // of the traveller's taste. In-range only (passed the metro reach filter).
    for (const a of base.filter((x) => x.must_see === 1 && inRange.has(x.id)).slice(0, RESERVE_ICONS)) {
      if (!chosen.has(a.id)) { chosen.add(a.id); reserved.push(a); }
    }
    // Additive neighbourhoods: reserve the chosen areas' members (must-sees first,
    // then top-ranked) — about a day-part's worth per area — so the interest build
    // COVERS each chosen area and the clusterer composes them into day-parts by
    // proximity (area A morning, area B / centre afternoon), keeping the user's days.
    if (areaMemberIds.length && body.areaGroups) {
      const areaSet = new Set(areaMemberIds);
      const mem = attractions.filter((a) => areaSet.has(a.id));
      const areaOrdered = [...mem.filter((a) => a.must_see === 1), ...mem.filter((a) => a.must_see !== 1)];
      const budget = (perDay + 1) * body.areaGroups.length;
      let cnt = 0;
      for (const a of areaOrdered) {
        if (cnt >= budget) break;
        if (!chosen.has(a.id)) { chosen.add(a.id); reserved.push(a); cnt++; }
      }
    }
    // DIVERSITY FLOOR: guarantee ~1 top-ranked stop of each MAJOR category the
    // traveller did NOT choose, so no trip is one-note ("even without picking
    // museums, one museum is good"). Chosen categories get the emphasis instead.
    const MAJOR = ["nature", "museum", "historic", "food"];
    for (const cat of MAJOR) {
      if (chosenCats.has(cat)) continue;
      const a = attractions.find((x) => !chosen.has(x.id) && catBucket(x) === cat);
      if (a) { chosen.add(a.id); reserved.push(a); }
    }
    // Keep the whole reserved backbone (icons + theme emphasis + diversity floor +
    // picks/areas) up to capacity; the category-capped fill tops it up.
    const capReserve = areaMemberIds.length
      ? Math.min(reserved.length, Math.round(rDays * perDay * 0.85))
      : Math.min(rDays * perDay, reserved.length);
    const front = reserved.slice(0, capReserve);
    const frontIds = new Set(front.map((a) => a.id));
    // PER-CATEGORY BALANCE CAP on the ranking fill so no single theme floods the trip
    // (Lisbon nature 13 → ~cap). A chosen category gets a generous cap (emphasis, split
    // when several are chosen); others get a small one. The reserved backbone is kept
    // but COUNTS toward the cap, so the TOTAL per category is bounded either way.
    const nCats = Math.max(1, chosenCats.size);
    const capChosen = Math.min(2 * rDays, Math.round((2 * rDays) / nCats) + 1);
    const capOther = Math.max(1, Math.round(rDays / 2));
    const catN = new Map<string, number>();
    for (const a of front) { const c = catBucket(a); catN.set(c, (catN.get(c) ?? 0) + 1); }
    // SOFT cap: the balanced set (within cap) leads, the over-cap remainder trails.
    // The whole pool stays available so the proximity clusterer can still build dense
    // days — but it fills from the diverse head first, so the trip is balanced and
    // only dips into an over-represented category when a day genuinely needs it nearby.
    // Absolute ceiling per category (as a FRACTION of trip size, so it barely touches
    // a balanced big city like London — keeping the pool dense for the clusterer —
    // while cutting extreme floods in a lopsided-data city like Lisbon). A CHOSEN
    // theme gets a high ceiling (it should lead); an unchosen catch-all (Lisbon files
    // landmarks under "attraction") gets a lower one, so it never out-weighs the theme.
    const cap = rDays * perDay;
    const capHardChosen = Math.max(capChosen, Math.round(cap * 0.5));
    const capHardOther = Math.max(capOther + 1, Math.round(cap * 0.3));
    const capped: Attraction[] = [], overflow: Attraction[] = [];
    for (const a of attractions) {
      if (frontIds.has(a.id)) continue;
      const c = catBucket(a);
      const isCat = chosenCats.has(c);
      const lim = isCat ? capChosen : capOther;
      const hard = isCat ? capHardChosen : capHardOther;
      const cur = catN.get(c) ?? 0;
      if (pickSet.has(a.id) || cur < lim) { catN.set(c, cur + 1); capped.push(a); }
      else if (cur < hard) { catN.set(c, cur + 1); overflow.push(a); }
      // else: over the absolute ceiling — dropped.
    }
    orderedFill = [...front, ...capped, ...overflow];
    // pin the reserved set (icons + themes + floor) to the front for the family sort.
    reservedIds = new Set(frontIds);
  }
  const buildList = [...streetStops, ...(sel ? [...sel.anchors, ...sel.fillers] : orderedFill)];
  // Sub-attractions ride in on their PARENT's rank, never their own. Adding them to
  // the candidate pool isn't enough — buildList is the ranked cut, and the Sistine
  // or the Pergamon would be trimmed out from under the complex they belong to.
  {
    const inList = new Set(buildList.map((a) => a.id));
    for (const a of attractions) {
      if (a.parent_id == null || inList.has(a.id) || !inList.has(a.parent_id)) continue;
      buildList.push(a); inList.add(a.id);
    }
  }
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
  // Assemble BuildOpts from a destination's own Brain techniques. Factored out so
  // the multi-city path can build per-SEGMENT opts (each city's own rules/centre),
  // not just reuse the first destination's.
  const optsFor = (d: Destination, r: Awaited<ReturnType<typeof brainRulesForDest>>) => ({
    month: body.month, seasonFilter: r.seasonFilter, dayEnderLast: r.dayEnderLast,
    maxTypePerDay: r.maxTypePerDay, avoidCats: isFamily ? r.avoid.families : r.avoid.adults,
    dayStartMin: r.dayStartMin, lunchAfterMin: r.lunchAfterMin, lunchMinutes: r.lunchMinutes, dwell: r.dwell,
    center: { lat: d.lat, lng: d.lng },
    daytripThresholdKm: r.daytripThresholdKm, daytripPerDays: r.daytripPerDays, daytripMaxStops: r.daytripMaxStops,
    samePlaceMeters: r.samePlaceMeters, freeGemMaxPerDay: r.freeGemMaxPerDay, freeGemDetourMin: r.freeGemDetourMin,
  });
  // reservedIds pins the interest/must-see reservation at the FRONT even for the
  // family path, whose familyFit re-sort would otherwise drop the icons.
  // Explicit ❤ picks are also GUARANTEED: after the proximity clusterer builds
  // walkable days, any picked place that got dropped (e.g. the scattered tail day
  // trimmed for cohesion) is force-added to its NEAREST day (≤8km, day may grow to
  // pace+2). So when the picks fit the trip's total capacity they all land instead
  // of a thin day + banked central picks. Truly far picks (>8km) still bank.
  const pickGuarantee = anchorIds && anchorIds.size ? anchorIds : undefined;
  // The EXPLICIT ❤ picks (not the must-see fallback anchorIds uses when nothing was
  // picked) are mandatory: the builder places every one of them in a day. This is
  // the product promise behind "המערכת תשלים את השאר" — what you chose is IN.
  const mustInclude = pickIds.length ? new Set(pickIds) : undefined;
  // Couples evening layer: the editor-curated evening streets/squares (streets.evening)
  // become soft after-dinner slots — one per day, nearest-first. Families skip it, and
  // a street the traveller already picked isn't offered twice.
  const eveningSpots = !isFamily
    ? (await approvedStreetsForCity(dest.id))
        .filter((s) => s.evening && !streetRows.some((r) => r.id === s.id))
        .map(streetAsStop)
    : [];
  // The floodlit-but-shut icons (night_passby technique) — same audience rule as
  // the evening slot: an after-dinner walk is a couples/friends thing.
  const nightIcons = !isFamily && rules.nightPassbyMax > 0 ? await nightPassbyForCity(dest.id) : [];
  // Variety: every build gets a fresh seed (or an explicit body.seed for exact
  // reproduction), so two couples with identical settings — or the same traveller
  // pressing 'בנה מחדש' — get genuinely different mid-tier picks.
  const seed = typeof body.seed === "number" ? (body.seed >>> 0) : (Math.floor(Math.random() * 0x7fffffff) >>> 0);
  const buildOpts = { ...optsFor(dest, rules), reservedIds, guaranteeIds: pickGuarantee,
    mustIncludeIds: mustInclude, dayMinutes: pace.minutes,
    seed, varietyJitter: rules.varietyJitter,
    ...(eveningSpots.length ? { eveningSpots, eveningStartMin: rules.eveningStart } : {}),
    ...(nightIcons.length ? { nightIcons, nightIconMax: rules.nightPassbyMax,
      nightIconKm: rules.nightPassbyKm, nightIconMinutes: rules.nightPassbyMinutes } : {}) ,
    eveningMaxStops: rules.eveningMaxStops, eveningHardEnd: rules.eveningHardEnd,
    minDayStops: rules.minDayStops, thinMergeKm: rules.thinMergeKm, thinSpareKm: rules.thinSpareKm, thinSpareKmCar: rules.thinSpareKmCar, thinMinMinutes: rules.thinMinMinutes,
    ...(Number.isFinite(body.driveHours) && (body.driveHours as number) > 0
      ? { maxDriveMin: Math.round((body.driveHours as number) * 60) } : {}) };
  // Best-of-N lottery-among-the-best (build_candidates technique): build N seeded
  // variants, score each with the Brain's critic, and serve a RANDOM variant from
  // those within `tolerance` points of the best — nobody gets the lottery's weak
  // draw, yet two identical requests still get different (equally good) trips.
  // An explicit body.seed bypasses the lottery: exact single-build reproduction.
  let servedPick: { seed: number; score: number } | null = null;
  const heuristicFor = (d: Destination, ndays: number, list: Attraction[], fam: boolean, pd: number, wp: number): Itinerary => {
    const single = (o: typeof buildOpts): Itinerary =>
      d.mobility === "car_base"
        ? buildCarBaseItinerary(d.city, d.country, ndays, list, { lat: d.lat, lng: d.lng }, fam, pd, wp, o)
        : buildHeuristicItinerary(d.city, d.country, ndays, list, fam, pd, wp, undefined, o);
    const N = typeof body.seed === "number" ? 1 : Math.max(1, rules.buildCandidates);
    if (N <= 1) return single(buildOpts);
    const byId = new Map(attractions.map((a) => [a.id, a]));
    const evIds = new Set(eveningSpots.map((s) => s.id));
    const cityMustCount = attractions.filter((a) => a.must_see === 1).length;
    const scored = Array.from({ length: N }, (_, i) => (seed + i * 101) >>> 0).map((s) => {
      const it = single({ ...buildOpts, seed: s });
      const rich: Attraction[][] = it.days.map((dd) =>
        dd.stops.map((st) => (st.id != null ? byId.get(st.id) : undefined)).filter((a): a is Attraction => !!a));
      const meta = it.days.map((dd) => {
        const real = dd.stops.filter((st) => st.id != null);
        const lastId = real.length ? real[real.length - 1].id : null;
        return { car: d.mobility === "car_base" || !!dd.dayTrip, eveningEnd: lastId != null && evIds.has(lastId) };
      });
      const score = critiqueTrip(rich, fam ? "families" : "adults",
        { cityMustCount, rules, dayMeta: meta, eveningCity: evIds.size > 0 }).score;
      return { it, score, s };
    });
    const best = Math.max(...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score >= best - rules.candidateTolerance);
    const pick = top[Math.floor(Math.random() * top.length)];
    servedPick = { seed: pick.s, score: pick.score };
    return pick.it;
  };
  const detailOf = (a: Attraction) => ({ id: a.id, name_he: a.name_he, name_en: a.name_en, image_url: a.image_url, category: a.category, lat: a.lat, lng: a.lng, tagline_he: a.tagline_he, tips_he: a.tips_he, best_time_he: a.best_time_he, dress_he: a.dress_he, cost_level: a.cost_level, website: a.website, must_see: a.must_see, parent_id: a.parent_id, passby_minutes: a.passby_minutes, time_of_day: a.time_of_day });
  // `opts.list` overrides the match list (neighbourhood builds pass the full area
  // pool so every area member resolves); `opts.surfaceIds`/`detailRows` say which
  // un-scheduled places land in "לא נכנסו ליומן" (default: the traveller's "כן").
  // Coarse, NON-PERSONAL origin for product analytics: country + device class,
  // straight off the edge headers. Deliberately NO IP and no city-level geo —
  // an IP is personal data under GDPR and would need its own legal basis.
  const ua = req.headers.get("user-agent") ?? "";
  const origin = {
    country: req.headers.get("x-vercel-ip-country") || null,
    device: /Mobile|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop",
  };
  const respondGenerate = (itin: Itinerary, engine?: string,
    opts?: { list?: Attraction[]; surfaceIds?: Set<number>; detailRows?: Attraction[] }) => {
    const scheduled = new Set<number>();
    const withDetails = attachDetails(itin, opts?.list ?? buildList, anchorIds, scheduled);
    recordTripEdges(dest, withDetails);
    annotateDaysWithAreas(withDetails.days, areas, { lat: dest.lat, lng: dest.lng });
    // car_base city → the whole trip is a rental-car trip; legs read as driving.
    if (dest.mobility === "car_base") withDetails.days.forEach((d) => { d.carBase = true; });
    const surfaceIds = opts?.surfaceIds ?? new Set<number>([...yesSet, ...areaMemberIds, ...streetStops.map((s) => s.id)]);
    const detailRows = opts?.detailRows ?? [...picks, ...areaMemberRows, ...streetStops];
    // The transparent BANK (Layer 4): what didn't get into the plan. The traveller's
    // OWN surfaced picks that didn't fit lead it (so a "כן" never just vanishes), then
    // the worthy UNSCHEDULED attractions, must-see FIRST — so the trip page can always
    // show "here's what's in reserve" (not just for explicit-pick builds). Streets are
    // excluded (isRealAttraction), as are already-scheduled stops.
    // SAFETY NET (engine-agnostic): a place the traveller explicitly ❤-picked is a
    // mandatory stop — it belongs IN the plan, never in the bank. The heuristic
    // already guarantees this via mustIncludeIds; this catches any other engine
    // (AI) and any late drop: each unscheduled pick is appended to the day whose
    // stops it is nearest to. Only real attractions with coords (streets/areas keep
    // their existing bank behaviour).
    const unplacedPicks = picks.filter((a) => yesSet.has(a.id) && !scheduled.has(a.id)
      && a.lat != null && a.lng != null && withDetails.days.length > 0);
    for (const a of unplacedPicks) {
      let bestD = 0, bestKm = Infinity;
      withDetails.days.forEach((day, di) => {
        for (const s of day.stops) {
          if (s.lat == null || s.lng == null) continue;
          const km = haversineKm(a.lat!, a.lng!, s.lat, s.lng);
          if (km < bestKm) { bestKm = km; bestD = di; }
        }
      });
      const day = withDetails.days[bestD];
      day.stops.push({
        name: a.name_he || a.name_en || "", kind: "culture", time: "", duration: "",
        id: a.id, ref: a.ref ?? refOf("attr", a.id), lat: a.lat, lng: a.lng,
        nameEn: a.name_en, image: a.image_url, website: a.website,
        tagline: a.tagline_he, description: a.description_he, bestTime: a.best_time_he,
        wiki: wikiUrl(a.info_sources), dress: a.dress_he, cost: a.cost_level,
        cat: a.category, sub: a.subcategory, anchor: true,
      });
      scheduled.add(a.id);
    }
    const explicit = (body.selection || streetStops.length || areaMemberIds.length || opts?.surfaceIds)
      ? detailRows.filter((a) => surfaceIds.has(a.id) && !scheduled.has(a.id))
      : [];
    const inBank = new Set(explicit.map((a) => a.id));
    // Bank source = the build list UNION the full ranked pool (deduped), so an
    // unscheduled must-see that never entered the build list (e.g. a manual/WYSIWYG
    // build, where buildList is ONLY the traveller's ❤ picks) still surfaces here.
    const bankSeen = new Set<number>();
    const bankCands = (opts?.list ?? [...buildList, ...attractions, ...pool]).filter((a) => {
      if (a.id == null || bankSeen.has(a.id)) return false; bankSeen.add(a.id); return true;
    });
    const extra = bankCands
      .filter((a) => isRealAttraction(a.id) && a.lat != null && a.lng != null && !scheduled.has(a.id) && !inBank.has(a.id))
      .map((a, i) => ({ a, i }))
      .sort((x, y) => (y.a.must_see === 1 ? 1 : 0) - (x.a.must_see === 1 ? 1 : 0) || x.i - y.i)
      .map((z) => z.a);
    // Keep EVERY unscheduled must-see in the bank (the traveller's safety net — esp. in
    // a manual build where none are pre-picked); cap only the non-must-see tail.
    const bankMusts = extra.filter((a) => a.must_see === 1);
    const bankRest = extra.filter((a) => a.must_see !== 1);
    const bankCap = Math.max(24, explicit.length + bankMusts.length);
    // Tag the traveller's OWN unscheduled picks (picked:true) so the trip page can
    // show them as a SEPARATE group ("מה שבחרת ולא נכנס") from the must-see
    // suggestions — the two must not blur together.
    const leftOut = [
      ...explicit.map((a) => ({ ...detailOf(a), picked: true })),
      ...bankMusts.map(detailOf),
      ...bankRest.map(detailOf),
    ].slice(0, bankCap);
    return NextResponse.json({ itinerary: withDetails, ...(engine ? { engine } : {}), leftOut, origin,
      ...(servedPick ? { seed: (servedPick as { seed: number; score: number }).seed, brainScore: (servedPick as { seed: number; score: number }).score } : {}) });
  };

  // Attach DB details to an existing itinerary — no AI, so it works without
  // credit and upgrades trips created before details existed.
  if (body.mode === "details") {
    if (!body.current) return NextResponse.json({ error: "missing current" }, { status: 400 });
    // Fetch the trip's OWN stop attractions by id, so a refresh attaches current
    // details (description, Wikipedia source, image) for every stop regardless of
    // whether the city pool happened to include them — the robust path for old trips.
    const stopIds = [...new Set(body.current.days.flatMap((d) => d.stops).map((s) => s.id).filter((x): x is number => typeof x === "number" && isRealAttraction(x)))];
    const stopRows = stopIds.length ? await attractionsByIds(stopIds) : [];
    const detailPool = [...stopRows, ...pool];
    // Re-attach coords/tagline to left-out picks (older trips stored them without),
    // so the map can show them as grey markers.
    let leftOut: object[] | undefined;
    if (body.leftOut?.length) {
      const rows = await attractionsByIds(body.leftOut.map((l) => l.id));
      leftOut = rows.map((a) => ({ id: a.id, name_he: a.name_he, name_en: a.name_en, image_url: a.image_url, category: a.category, lat: a.lat, lng: a.lng, tagline_he: a.tagline_he, tips_he: a.tips_he, best_time_he: a.best_time_he, dress_he: a.dress_he, cost_level: a.cost_level, website: a.website }));
    }
    return NextResponse.json({ itinerary: attachDetails(body.current, detailPool), ...(leftOut ? { leftOut } : {}) });
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
        attractions: rankByTaste(await topAttractions(x.dest.id, 150, (x.days ?? 1) * POOL_PER_DAY), body.taste, 90, isFamily, [], audience),
        insights: await insightsForDestination(x.dest.id),
        // each segment's OWN Brain techniques (avoids/dwell/lunch/centre)
        opts: optsFor(x.dest, await brainRulesForDest(x.dest.id)),
      })));
    const allAttractions = segAttrs.flatMap((x) => x.attractions);
    const heuristic = () => attachDetails(
      buildMultiHeuristicItinerary(segAttrs.map((x) => ({
        city: x.dest.city, country: x.dest.country, days: x.days, attractions: x.attractions, opts: x.opts,
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
    // The marked "add" ids come from leftOut, which can include a "כן" pick ranked
    // past the 90-item taste cap in `attractions`. Fetch those explicitly and merge,
    // so an add is never silently dropped for being outside the ranked slice.
    const known = new Set(attractions.map((a) => a.id));
    const missing = (body.addIds ?? []).filter((id) => !known.has(id));
    const extra = missing.length ? await attractionsByIds(missing) : [];
    const arrangePool = [...attractions, ...extra];
    const r = arrangeDay(body.current, body.dayIndex, body.addIds ?? [], body.removeIds ?? [], arrangePool);
    return NextResponse.json({ itinerary: attachDetails(r.itinerary, arrangePool), engine: "heuristic" });
  }

  // "More attractions" bank top-up — profile-fitting candidates for the city that
  // aren't already in the trip, ranked, with the same detail fields a bank card has.
  if (body.mode === "suggest") {
    const used = new Set(body.usedIds ?? []);
    const cands = buildList.filter((a) => a.id != null && !used.has(a.id) && a.lat != null && a.lng != null).slice(0, 40);
    const suggestions = cands.map((a) => ({
      id: a.id, name_he: a.name_he, name_en: a.name_en, image_url: a.image_url, category: a.category,
      lat: a.lat, lng: a.lng, tagline_he: a.tagline_he, tips_he: a.tips_he,
      best_time_he: a.best_time_he, dress_he: a.dress_he, cost_level: a.cost_level, website: a.website,
    }));
    return NextResponse.json({ suggestions });
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

  // Chosen neighbourhoods are now ADDITIVE (Layer 2): their members are folded into
  // the pool and reserved above, and their streets auto-included — so they fall
  // through to the normal interest-governed build below, which composes them into
  // day-PARTS by proximity while keeping the traveller's day count. (The old
  // one-day-per-area seedGroups branch — which overrode the day count — is retired.)

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
