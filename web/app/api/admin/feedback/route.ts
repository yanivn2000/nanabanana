import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { setFeedbackHandled, deleteFeedback } from "@/lib/db";

export const dynamic = "force-dynamic";

// Team-only: manage the feedback queue. POST { id, action: "handle" | "unhandle"
// | "delete" }.
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = typeof b?.id === "number" ? b.id : null;
  if (id == null) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  if (b.action === "delete") {
    await deleteFeedback(id);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "handle" || b.action === "unhandle") {
    await setFeedbackHandled(id, b.action === "handle");
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
