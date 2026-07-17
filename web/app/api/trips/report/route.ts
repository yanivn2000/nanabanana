import { NextRequest, NextResponse } from "next/server";
import { reportComment, reportSharedTrip } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Public "🚩 דיווח" on a comment or a whole shared trip. Bumps a report counter
// that surfaces the item in the admin moderation queue. Rate-limited so it
// can't be used to spam-flag either.
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "report", 20, 3600);
  if (limited) return limited;
  const b = await req.json().catch(() => null);
  if (b?.type === "comment" && typeof b.comment_id === "number") {
    const ok = await reportComment(b.comment_id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (b?.type === "trip" && typeof b.slug === "string") {
    const ok = await reportSharedTrip(b.slug);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}
