import { NextResponse } from "next/server";
import {
  listDestinations, destinationSummaries, attractionsForMap,
  insightsForDestination, countSharedTripsForDestination, getDestination,
} from "@/lib/db";

export const dynamic = "force-dynamic";

// TEMPORARY diagnostic — surfaces which query throws in the Vercel runtime and
// its error message. Remove after debugging the prod 500s.
async function tryOne(name: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    const len = Array.isArray(r) ? r.length : (r == null ? 0 : 1);
    return { name, ok: true, len };
  } catch (e) {
    return { name, ok: false, error: (e as Error).message, stack: (e as Error).stack?.split("\n").slice(0, 3) };
  }
}

export async function GET() {
  const results = await Promise.all([
    tryOne("listDestinations", () => listDestinations()),
    tryOne("destinationSummaries", () => destinationSummaries()),
    tryOne("getDestination(14)", () => getDestination(14)),
    tryOne("attractionsForMap(14,2000)", () => attractionsForMap(14, 2000)),
    tryOne("insightsForDestination(14)", () => insightsForDestination(14)),
    tryOne("countSharedTripsForDestination(14)", () => countSharedTripsForDestination(14)),
  ]);
  return NextResponse.json({ port: (process.env.DATABASE_URL ?? "").match(/:(\d{4})\//)?.[1], results });
}
