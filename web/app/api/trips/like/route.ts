import { NextRequest, NextResponse } from "next/server";
import { likeSharedTrip } from "@/lib/db";

export const dynamic = "force-dynamic";

// Anonymous ❤️ toggle on a shared trip. Dedup is client-side (one like per
// browser via localStorage) — good enough for social proof at this stage.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const slug = typeof b?.slug === "string" ? b.slug : "";
  if (!slug) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const likes = await likeSharedTrip(slug, b?.on !== false);
  if (likes == null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ likes });
}
