import { NextRequest, NextResponse } from "next/server";
import { likeSharedTrip } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Anonymous ❤️ toggle on a shared trip. Deduped server-side by (slug, ip) so the
// count can't be inflated past one per client; rate-limited as a second guard.
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "like", 30, 60);
  if (limited) return limited;
  const b = await req.json().catch(() => null);
  const slug = typeof b?.slug === "string" ? b.slug : "";
  if (!slug) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const likes = await likeSharedTrip(slug, clientIp(req), b?.on !== false);
  if (likes == null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ likes });
}
