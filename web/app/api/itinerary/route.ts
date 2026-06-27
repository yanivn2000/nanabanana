import { NextRequest, NextResponse } from "next/server";
import { listDestinations, topAttractions } from "@/lib/db";
import {
  aiConfigured,
  generateItinerary,
  reviseItinerary,
} from "@/lib/ai";
import { buildHeuristicItinerary } from "@/lib/heuristic";
import { haversineKm } from "@/lib/geo";
import type { TripHotel } from "@/lib/ai";
import type { Itinerary } from "@/lib/trip-types";

export const dynamic = "force-dynamic";

// Match by city name; otherwise (e.g. a hotel in a village we didn't ingest)
// pick the nearest ingested destination by coordinates.
function resolveDestination(city?: string, lat?: number, lng?: number) {
  const dests = listDestinations();
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

export async function POST(req: NextRequest) {
  let body: {
    mode: "generate" | "revise";
    city?: string;
    days?: number;
    month?: number;
    profileText?: string;
    hotels?: TripHotel[];
    current?: Itinerary;
    instruction?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const near = body.hotels?.[0];
  const dest = resolveDestination(body.city, near?.lat, near?.lng);
  if (!dest) {
    return NextResponse.json({ error: "no destinations in DB" }, { status: 404 });
  }
  const attractions = topAttractions(dest.id, 50);

  // Revise needs the model. Without a key, ask the user to add one.
  if (body.mode === "revise" && !aiConfigured()) {
    return NextResponse.json({ error: "AI not configured", code: "no_key" }, { status: 503 });
  }

  // Generate works without a key via the heuristic builder; AI upgrades it.
  if (body.mode !== "revise" && !aiConfigured()) {
    const itinerary = buildHeuristicItinerary(
      dest.city, dest.country, body.days ?? 4, attractions
    );
    return NextResponse.json({ itinerary, engine: "heuristic" });
  }

  if (body.mode === "revise") {
    if (!body.current || !body.instruction) {
      return NextResponse.json({ error: "missing current/instruction" }, { status: 400 });
    }
    try {
      const itinerary = await reviseItinerary(
        body.current, body.instruction, attractions, body.profileText
      );
      return NextResponse.json({ itinerary });
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
    });
    return NextResponse.json({ itinerary });
  } catch (e) {
    console.warn(`[itinerary] AI generate failed, using heuristic: ${(e as Error).message}`);
    const itinerary = buildHeuristicItinerary(dest.city, dest.country, body.days ?? 4, attractions);
    return NextResponse.json({ itinerary, engine: "heuristic" });
  }
}
