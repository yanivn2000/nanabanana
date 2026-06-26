import { NextRequest, NextResponse } from "next/server";
import { listDestinations, attractionsForMap } from "@/lib/db";
import { haversineKm } from "@/lib/geo";

export const dynamic = "force-dynamic";

// Given the traveler's GPS, find the nearest destination in our DB and return
// its attractions sorted by distance from the traveler.
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "missing lat/lng" }, { status: 400 });
  }

  const dests = listDestinations();
  if (dests.length === 0) {
    return NextResponse.json({ error: "no destinations" }, { status: 404 });
  }

  const nearestDest = dests
    .map((d) => ({ d, km: haversineKm(lat, lng, d.lat, d.lng) }))
    .sort((a, b) => a.km - b.km)[0];

  const attractions = attractionsForMap(nearestDest.d.id, 200)
    .filter((a) => a.lat && a.lng)
    .map((a) => ({
      ...a,
      distanceKm: haversineKm(lat, lng, a.lat as number, a.lng as number),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 30);

  return NextResponse.json({
    destination: nearestDest.d,
    destinationKm: nearestDest.km,
    attractions,
  });
}
