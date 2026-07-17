import { NextRequest, NextResponse } from "next/server";
import { addTripComment, setCommentHelpful } from "@/lib/db";

export const dynamic = "force-dynamic";

// Community comments on a shared trip — open to everyone, name + text only
// (the Facebook-group experience, anchored to a specific day when relevant).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const name = typeof b?.author_name === "string" ? b.author_name.trim() : "";
  const body = typeof b?.body === "string" ? b.body.trim() : "";
  const slug = typeof b?.slug === "string" ? b.slug : "";
  if (!slug || name.length < 2 || name.length > 40 || body.length < 3 || body.length > 2000) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const dayIndex = typeof b.day_index === "number" && b.day_index >= 0 ? Math.floor(b.day_index) : null;
  const comment = await addTripComment(slug, dayIndex, name, body);
  if (!comment) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  return NextResponse.json({ comment });
}

// The trip owner marks a comment "עזר לי" (owner_token proves ownership).
export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.slug || !b?.owner_token || typeof b?.comment_id !== "number") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const ok = await setCommentHelpful(String(b.slug), String(b.owner_token), b.comment_id, b.helpful !== false);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "forbidden" }, { status: 403 });
}
