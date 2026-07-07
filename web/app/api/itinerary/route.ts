import { NextRequest, NextResponse } from "next/server";
import { listDestinations, topAttractions, insightsForDestination } from "@/lib/db";
import type { Attraction, Destination } from "@/lib/db";
import {
  aiConfigured,
  generateItinerary,
  generateMultiItinerary,
  reviseItinerary,
} from "@/lib/ai";
import { buildHeuristicItinerary, buildMultiHeuristicItinerary } from "@/lib/heuristic";
import { rankByTaste, tasteEmphasis } from "@/lib/taste";
import { haversineKm } from "@/lib/geo";
import type { TripHotel } from "@/lib/ai";
import type { Itinerary } from "@/lib/trip-types";

export const dynamic = "force-dynamic";

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

// Match each itinerary stop back to its DB attraction and attach details
// (image, website, coords, tagline, time/dress/cost) for the expandable view.
function attachDetails(it: Itinerary, attractions: Attraction[]): Itinerary {
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
        s.image = a.image_url; s.website = a.website;
        s.lat = a.lat; s.lng = a.lng;
        s.tagline = a.tagline_he; s.bestTime = a.best_time_he;
        s.dress = a.dress_he; s.cost = a.cost_level;
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const near = body.hotels?.[0];
  const dest = await resolveDestination(body.city, near?.lat, near?.lng);
  if (!dest) {
    return NextResponse.json({ error: "no destinations in DB" }, { status: 404 });
  }
  // Broad candidate pool, then narrow to the group's TASTE (#63): a music/
  // vintage couple and a sports/history couple get different attraction sets
  // fed to the builder → genuinely different trips. No taste → family order.
  const pool = await topAttractions(dest.id, 150);
  const attractions = rankByTaste(pool, body.taste, 50);

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
        attractions: rankByTaste(await topAttractions(x.dest.id, 150), body.taste, 50),
        insights: await insightsForDestination(x.dest.id),
      })));
    const allAttractions = segAttrs.flatMap((x) => x.attractions);
    const heuristic = () => attachDetails(
      buildMultiHeuristicItinerary(segAttrs.map((x) => ({
        city: x.dest.city, country: x.dest.country, days: x.days, attractions: x.attractions,
      }))), allAttractions);

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
        profileText: body.profileText ?? "משפחה · קצב רגוע",
        emphasis: tasteEmphasis(body.taste),
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
  if (body.mode !== "revise" && !aiConfigured()) {
    const itinerary = attachDetails(buildHeuristicItinerary(
      dest.city, dest.country, body.days ?? 4, attractions), attractions);
    return NextResponse.json({ itinerary, engine: "heuristic" });
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
      profileText: body.profileText ?? "משפחה · קצב רגוע",
      attractions,
      hotels: body.hotels,
      insights: await insightsForDestination(dest.id),
      emphasis: tasteEmphasis(body.taste),
    });
    return NextResponse.json({ itinerary: attachDetails(itinerary, attractions) });
  } catch (e) {
    console.warn(`[itinerary] AI generate failed, using heuristic: ${(e as Error).message}`);
    const itinerary = attachDetails(
      buildHeuristicItinerary(dest.city, dest.country, body.days ?? 4, attractions), attractions);
    return NextResponse.json({ itinerary, engine: "heuristic" });
  }
}
