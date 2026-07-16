import { NextRequest, NextResponse } from "next/server";
import { addFeedback } from "@/lib/db";

export const dynamic = "force-dynamic";

const KINDS = new Set(["bug", "idea", "other"]);

// Public: user feedback ("מצאתם באג? יש רעיון?"). Stored in the feedback table;
// the team reads it in /admin. Anonymous by design — email is optional.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const message = typeof b?.message === "string" ? b.message.trim() : "";
  if (message.length < 3 || message.length > 4000) {
    return NextResponse.json({ error: "bad_message" }, { status: 400 });
  }
  await addFeedback({
    kind: KINDS.has(b.kind) ? b.kind : "other",
    message,
    email: typeof b.email === "string" && b.email.length <= 200 ? b.email : null,
    page: typeof b.page === "string" ? b.page.slice(0, 300) : null,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  return NextResponse.json({ ok: true });
}
