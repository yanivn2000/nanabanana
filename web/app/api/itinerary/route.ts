import { NextRequest, NextResponse } from "next/server";
import { listDestinations, topAttractions } from "@/lib/db";
import {
  aiConfigured,
  generateItinerary,
  reviseItinerary,
} from "@/lib/ai";
import { buildHeuristicItinerary } from "@/lib/heuristic";
import type { Itinerary } from "@/lib/trip-types";

export const dynamic = "force-dynamic";

function resolveDestination(city?: string) {
  const dests = listDestinations();
  if (dests.length === 0) return null;
  if (city) {
    const match = dests.find((d) => d.city.toLowerCase() === city.toLowerCase());
    if (match) return match;
  }
  return dests[0]; // default: most-populated destination
}

export async function POST(req: NextRequest) {
  let body: {
    mode: "generate" | "revise";
    city?: string;
    days?: number;
    travellers?: string;
    tags?: string[];
    current?: Itinerary;
    instruction?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const dest = resolveDestination(body.city);
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

  try {
    let itinerary: Itinerary;
    if (body.mode === "revise") {
      if (!body.current || !body.instruction) {
        return NextResponse.json({ error: "missing current/instruction" }, { status: 400 });
      }
      itinerary = await reviseItinerary(body.current, body.instruction, attractions);
    } else {
      itinerary = await generateItinerary({
        city: dest.city,
        country: dest.country,
        days: body.days ?? 4,
        travellers: body.travellers ?? "משפחה · 4 נוסעים",
        tags: body.tags ?? ["טבע", "ילדים", "קצב רגוע"],
        attractions,
      });
    }
    return NextResponse.json({ itinerary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
