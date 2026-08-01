import { NextRequest, NextResponse } from "next/server";
import { addFeedback } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { sendTeamEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";

const KINDS = new Set(["bug", "idea", "other"]);
const KIND_HE: Record<string, string> = { bug: "באג", idea: "רעיון", other: "משוב" };

// Public: user feedback ("מצאתם באג? יש רעיון?"). Stored in the feedback table
// (team reads it in /admin) AND emailed to the team. Anonymous by design — email
// is optional; when given it's used as reply-to.
export async function POST(req: NextRequest) {
  // Public + unauthenticated → rate-limit so it can't be used to spam the inbox.
  const limited = await rateLimit(req, "feedback", 10, 3600); // ≤10/hour per IP
  if (limited) return limited;

  const b = await req.json().catch(() => null);
  const message = typeof b?.message === "string" ? b.message.trim() : "";
  if (message.length < 3 || message.length > 4000) {
    return NextResponse.json({ error: "bad_message" }, { status: 400 });
  }
  const kind = KINDS.has(b.kind) ? b.kind : "other";
  const email = typeof b.email === "string" && b.email.length <= 200 ? b.email : null;
  const page = typeof b.page === "string" ? b.page.slice(0, 300) : null;

  await addFeedback({
    kind, message, email, page,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });

  // Notify the team (best-effort; inert until RESEND_API_KEY is set). Only reply-to
  // when the sender left a plausible email.
  const replyTo = email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
  await sendTeamEmail({
    subject: `[Yalle · ${KIND_HE[kind]}] משוב חדש${email ? ` — ${email}` : ""}`,
    text: `משוב חדש מ־Yalle\n\nסוג: ${KIND_HE[kind]}\nמאת: ${email || "אנונימי"}\nעמוד: ${page ?? "-"}\n\n${message}`,
    replyTo,
  });

  return NextResponse.json({ ok: true });
}
