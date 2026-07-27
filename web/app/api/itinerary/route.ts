import { NextRequest, NextResponse } from "next/server";
import { listDestinations, topAttractions, insightsForDestination, attractionsByIds, interestCandidates, recordWalkEdges, areasForDestination, brainRulesForDest, streetsByIds, approvedStreetsForCity } from "@/lib/db";
import { annotateDaysWithAreas } from "@/lib/cluster";
import type { Attraction, Destination, Street } from "@/lib/db";
import { refOf, synthId, isRealAttraction } from "@/lib/place";
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
import { rankByTaste, tasteEmphasis, tasteScore, coarseFits, interestTasteMap, INTEREST_KEYWORDS, INTEREST_TASTE, INTEREST_CATS } from "@/lib/taste";
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

// Split the pool into the Explore selection's two tiers (F1). Anchors = the
// traveler's "כן" picks (or, if they chose none, the must-sees) so the day has a
// real centerpiece; fillers = everything else they didn't rule out ("לא").
function partitionBySelection(
  pool: Attraction[],
  taste: Record<string, number> | undefined,
  selection: { yes: number[]; no: number[] },
  isFamily: boolean
): { anchors: Attraction[]; fillers: Attraction[]; anchorIds: Set<number> } {
  const yes = new Set(selection.yes);
  const no = new Set(selection.no);
  const avail = pool.filter((a) => !no.has(a.id));
  let anchorPool = avail.filter((a) => yes.has(a.id));
  if (anchorPool.length === 0) anchorPool = avail.filter((a) => a.must_see === 1);
  const anchors = rankByTaste(anchorPool, taste, 30, isFamily);
  const anchorIds = new Set(anchors.map((a) => a.id));
  // Fillers complete the days, but ONLY with must-sees (never an unmarked minor
  // place): an unmarked attraction enters only if it's a must-see or sits in a
  // chosen neighbourhood (handled by the area path). So a build never surprises
  // the traveller with a place they didn't pick and that isn't a headline sight.
  const fillers = rankByTaste(
    avail.filter((a) => a.must_see === 1 && !anchorIds.has(a.id)), taste, 40, isFamily);
  return { anchors, fillers, anchorIds };
}


// A picked street is a full stop, not a transition. It enters the build as a
// synthetic attraction: a namespaced id in the "street" range (its own id space,
// so it can never collide with a real attraction id) + its canonical ref, and
// its curated dwell via visit_minutes.
function streetAsStop(s: Street): Attraction {
  const g = s.geometry;
  const ends: [[number, number], [number, number]] | null =
    g && g.length > 1 ? [g[0], g[g.length - 1]] : null;
  return {
    ends, path: g ?? null,
    id: synthId("street", s.id), ref: refOf("street", s.id),
    name_he: s.name_he, name_en: s.name_en, lat: s.lat, lng: s.lng,
    category: "attraction", subcategory: "street", indoor_outdoor: null,
    family_score: null, tips_he: s.vibe_he, website: null, duration_minutes: null,
    visit_minutes: s.dwell_min ?? 45, image_url: null, tagline_he: s.best_for_he,
    best_season: null, best_time_he: null, time_of_day: null, dress_he: null,
    cost_level: null, must_see: 1, osm_must_see: null, editor_rank: null,
    editor_kids: null, description_he: null, taste_tags: null, audience_fit: null,
    admin_bonus: null, notable: false,
  };
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
        // A builder-trimmed street carries its own (trimmed) path + centroid;
        // don't clobber it with the full-street geometry from the pool.
        if (!s.path) { s.lat = a.lat; s.lng = a.lng; }
        s.tagline = a.tagline_he; s.bestTime = a.best_time_he;
        s.dress = a.dress_he; s.cost = a.cost_level;
        s.cat = a.category; s.sub = a.subcategory;
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
    interests?: string[];
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
  // The "משפחות" audience chip alone (not only a kids-in-profile flag) drives the
  // family build path: family-friendly ranking of the FILL, so a family trip skews
  // to places kids enjoy while the shared must-see icons stay in for everyone.
  const isFamily = body.isFamily === true || body.audience === "families";
  // The Brain's techniques (brain_principles) for this city — the builder obeys these.
  const rules = await brainRulesForDest(dest.id);
  // heuristic stops/day. Families get at least their pace-rule floor (fuller day).
  const perDay = isFamily ? Math.max(paceToPerDay(body.pace), rules.paceStops.families) : paceToPerDay(body.pace);
  // Base pool = top 150; then fold in the traveler's exact picks AND the members of
  // any chosen neighbourhoods (even ones ranked below 150) so a chosen place / area
  // member is always a real build candidate.
  const base = await topAttractions(dest.id, 150);
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
  // Chosen interest chips (GOVERNING_INTERESTS keys) — govern the pick alongside
  // taste, and drive the coarse fallback + theme reservation below.
  const interests = Array.isArray(body.interests) ? body.interests.filter((s): s is string => typeof s === "string") : [];
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
  if (audience === "adults" && !interests.includes("פארקי שעשועים") && !interests.includes("ילדים")) {
    pool = pool.filter((a) => pickIds.includes(a.id) || !isKidOnly(a));
  }
  // Thin-interest rescue: nightlife/niche-shop venues rank too low to reach the base
  // pool, so an explicitly chosen thin interest would surface NOTHING. Fetch the best
  // matches directly (union across chosen interests, quality-first) and guarantee them
  // as candidates below — the theme reservation then reserves its share of them.
  // Fetch PER interest (not one union query with a shared limit) — otherwise in a
  // multi-interest build a dense theme (museums) eats the whole limit and a thin one
  // (nightlife) fetches nothing. Each interest gets its own slice; then dedup.
  const interestRows = interests.length
    ? Object.values(Object.fromEntries(
        (await Promise.all(interests.map((k) => interestCandidates(dest.id, {
          tags: INTEREST_TASTE[k] ?? [], cats: INTEREST_CATS[k]?.cats ?? [],
          subs: INTEREST_CATS[k]?.subs ?? [], kws: INTEREST_KEYWORDS[k] ?? [],
        }, Math.max(10, 3 * (body.days ?? 4))))))
        .flat().map((a) => [a.id, a] as const)))
    : [];
  // Wider pool (was 50) so the clusterer has a long tail of minor places to pull
  // in as "free gems" on the walking path (cluster.ts pass B).
  const rankedByTaste = rankByTaste(pool, body.taste, 90, isFamily, interests, audience);
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
  for (const a of [...areaMemberRows, ...picks, ...interestRows]) {
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
  const sel = (body.selection && !governed) ? partitionBySelection(pool, body.taste, body.selection, isFamily) : null;
  // Streets the traveller picked lead the build list, so the clusterer treats
  // them as the day's top candidates (they were an explicit "כן").
  const streetRows = Array.isArray(body.streetIds) && body.streetIds.length
    ? await streetsByIds(body.streetIds.filter((n) => typeof n === "number")) : [];
  // Streets now enter AUTOMATICALLY (there's no manual street-picking strip):
  //  • a chosen neighbourhood pulls its own streets — "I'm already in the area, of
  //    course I'll walk its main streets" (independent of interests);
  //  • the "אדריכלות ורחובות" interest pulls the city's top worthy streets, so "I
  //    love walking pretty streets" delivers streets even without choosing an area.
  // Deduped against each other + any legacy body.streetIds (saved trips).
  const chosenAreaIds = Array.isArray(body.areaIds) ? body.areaIds.filter((n): n is number => typeof n === "number") : [];
  const wantStreetInterest = interests.includes("אדריכלות");
  if (chosenAreaIds.length || wantStreetInterest) {
    const allStreets = await approvedStreetsForCity(dest.id);
    const have = new Set(streetRows.map((s) => s.id));
    const add: typeof allStreets = [];
    const take = (s: (typeof allStreets)[number]) => { if (!have.has(s.id)) { have.add(s.id); add.push(s); } };
    if (chosenAreaIds.length) allStreets.filter((s) => s.area_id != null && chosenAreaIds.includes(s.area_id)).forEach(take);
    if (wantStreetInterest) allStreets.filter((s) => s.lat != null).slice(0, 5).forEach(take);
    streetRows.push(...add);
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
  let guaranteeIds: Set<number> | undefined;   // chosen-theme stops the clusterer may drop (scattered)
  let orderedFill: Attraction[] = attractions;
  if (!sel) {
    const rDays = body.days ?? 4;
    const RESERVE_ICONS = Math.max(3, rDays);
    // THEME BUDGET: guarantee ~2 themed stops per day, SPLIT across the chosen
    // interests — so fewer interests = deeper focus on each (a single-interest trip
    // leans hard into that one topic instead of a token 2), and more interests share
    // the same budget. The overlap with the city's must-sees (a museum-lover's MNAC)
    // fills the icon backbone too, so the ~2/day themed layer sits on top of the icons.
    const themeBudget = 2 * rDays;
    const perInterest = interests.length ? Math.max(1, Math.round(themeBudget / interests.length)) : 0;
    // Each chosen interest → the DB category bucket(s) it emphasises. Drives the
    // diversity floor + balance caps below (so the fill can't flood one category).
    const INT_CATS: Record<string, string[]> = {
      "מוזיאונים": ["museum"], "אוכל": ["food", "shopping"], "טבע": ["nature"],
      // "attraction" is a catch-all where many cities file monuments/landmarks
      // (Lisbon tags its historic sites there), so history/architecture claim it too.
      "חיי לילה": ["food"], "היסטוריה": ["historic", "attraction"], "אדריכלות": ["historic", "attraction"],
      "וינטג'": ["shopping"], "פארקי שעשועים": ["nature"], "חופים": ["nature"],
    };
    const chosenCats = new Set(interests.flatMap((it) => INT_CATS[it] ?? []));
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
    // Theme guarantee: up to `perInterest` matching stops per chosen interest — by
    // taste-tag, by coarse category, OR by a name keyword (markets are often mis-tagged
    // as generic places). A thin interest that can't fill its share just yields fewer
    // (the ranking fill takes the rest) rather than inventing places.
    const themeIds = new Set<number>();
    for (const it of interests) {
      const w = interestTasteMap(it), kws = INTEREST_KEYWORDS[it] ?? [];
      let k = 0;
      // interestRows first (quality-ordered thin-interest venues), then the ranked
      // pool — so a chosen thin interest reserves its best venues before generic fill.
      for (const a of [...interestRows, ...attractions]) {
        if (k >= perInterest) break;
        if (chosen.has(a.id)) continue;
        const nm = a.name_he || a.name_en || "";
        const match = (a.taste_tags && tasteScore(a.taste_tags, w) > 0)
          || coarseFits(a.category, a.subcategory, [it])
          || kws.some((kw) => nm.includes(kw));
        if (match) { chosen.add(a.id); reserved.push(a); themeIds.add(a.id); k++; }
      }
    }
    // The theme-reserved stops are the ones the guarantee pass protects from the
    // proximity clusterer dropping them (a scattered bar / peripheral park).
    guaranteeIds = themeIds;
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
  const buildOpts = { ...optsFor(dest, rules), reservedIds, guaranteeIds };
  const heuristicFor = (d: Destination, ndays: number, list: Attraction[], fam: boolean, pd: number, wp: number): Itinerary =>
    d.mobility === "car_base"
      ? buildCarBaseItinerary(d.city, d.country, ndays, list, { lat: d.lat, lng: d.lng }, fam, pd, wp, buildOpts)
      : buildHeuristicItinerary(d.city, d.country, ndays, list, fam, pd, wp, undefined, buildOpts);
  const detailOf = (a: Attraction) => ({ id: a.id, name_he: a.name_he, name_en: a.name_en, image_url: a.image_url, category: a.category, lat: a.lat, lng: a.lng, tagline_he: a.tagline_he, tips_he: a.tips_he, best_time_he: a.best_time_he, dress_he: a.dress_he, cost_level: a.cost_level, website: a.website, must_see: a.must_see });
  // `opts.list` overrides the match list (neighbourhood builds pass the full area
  // pool so every area member resolves); `opts.surfaceIds`/`detailRows` say which
  // un-scheduled places land in "לא נכנסו ליומן" (default: the traveller's "כן").
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
    const explicit = (body.selection || streetStops.length || areaMemberIds.length || opts?.surfaceIds)
      ? detailRows.filter((a) => surfaceIds.has(a.id) && !scheduled.has(a.id))
      : [];
    const inBank = new Set(explicit.map((a) => a.id));
    const extra = (opts?.list ?? buildList)
      .filter((a) => isRealAttraction(a.id) && a.lat != null && a.lng != null && !scheduled.has(a.id) && !inBank.has(a.id))
      .map((a, i) => ({ a, i }))
      .sort((x, y) => (y.a.must_see === 1 ? 1 : 0) - (x.a.must_see === 1 ? 1 : 0) || x.i - y.i)
      .map((z) => z.a);
    const leftOut = [...explicit, ...extra].slice(0, 24).map(detailOf);
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
      leftOut = rows.map((a) => ({ id: a.id, name_he: a.name_he, name_en: a.name_en, image_url: a.image_url, category: a.category, lat: a.lat, lng: a.lng, tagline_he: a.tagline_he, tips_he: a.tips_he, best_time_he: a.best_time_he, dress_he: a.dress_he, cost_level: a.cost_level, website: a.website }));
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
        attractions: rankByTaste(await topAttractions(x.dest.id, 150), body.taste, 90, isFamily, interests, audience),
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
