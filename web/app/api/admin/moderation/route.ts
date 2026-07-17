import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { listModerationQueue, setCommentHidden, setSharedTripHidden } from "@/lib/db";

export const dynamic = "force-dynamic";

// Team-only moderation. GET = the queue (reported/hidden items); POST = hide or
// unhide a comment or a whole trip.
export async function GET() {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await listModerationQueue());
}

export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const hidden = b?.hidden !== false;
  if (b?.type === "comment" && typeof b.id === "number") {
    await setCommentHidden(b.id, hidden);
    return NextResponse.json({ ok: true });
  }
  if (b?.type === "trip" && typeof b.slug === "string") {
    await setSharedTripHidden(b.slug, hidden);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}
