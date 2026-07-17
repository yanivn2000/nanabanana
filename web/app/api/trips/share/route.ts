import { NextRequest, NextResponse } from "next/server";
import { publishSharedTrip, unpublishSharedTrip } from "@/lib/db";
import type { Itinerary } from "@/lib/trip-types";

export const dynamic = "force-dynamic";

// Publish a trip to a public URL (or update an existing share with slug+token).
// Anonymous by design: ownership = the returned owner_token, kept client-side.
// The payload is SANITIZED here — only itinerary + trip meta; never the raw
// profile (no kid names, no emails).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const it = b?.itinerary as Itinerary | undefined;
  if (!b || !it || !Array.isArray(it.days) || it.days.length === 0) {
    return NextResponse.json({ error: "no_itinerary" }, { status: 400 });
  }
  if (JSON.stringify(it).length > 300_000) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : "טיול";
  const res = await publishSharedTrip({
    title,
    city: str(b.city), city_he: str(b.city_he), country: str(b.country), country_he: str(b.country_he),
    destination_id: num(b.destination_id), days: num(b.days), month: num(b.month),
    composition: str(b.composition)?.slice(0, 120) ?? null,
    pace: str(b.pace),
    itinerary: it,
    remix_of: str(b.remix_of),
    slug: str(b.slug), owner_token: str(b.owner_token),
  });
  if (!res) return NextResponse.json({ error: "publish_failed" }, { status: 409 });
  return NextResponse.json(res);
}

export async function DELETE(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.slug || !b?.owner_token) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const ok = await unpublishSharedTrip(String(b.slug), String(b.owner_token));
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
