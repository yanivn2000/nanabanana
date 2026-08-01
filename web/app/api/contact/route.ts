import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addFeedback } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Where contact messages go, and who they're "from" for delivery. Resend requires
// the From to be a domain you verify — verify yalle.co in Resend, then set
// CONTACT_FROM="Yalle <contact@yalle.co>". The user's own address goes in reply_to
// so the team can just hit Reply.
const TO = process.env.CONTACT_TO || "support@eos-online.com";
const FROM = process.env.CONTACT_FROM || "Yalle <onboarding@resend.dev>";

// Contact form — LOGGED-IN users only. The sender identity is the user's account
// email (verified server-side via Supabase), so there's no spoofing and no spam
// from anonymous visitors. The message is emailed to the team AND stored in the
// feedback table as a backup (visible in /admin) so nothing is lost even before
// email delivery is configured.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const limited = await rateLimit(req, "contact", 5, 3600); // ≤5/hour per IP
  if (limited) return limited;

  const b = await req.json().catch(() => null);
  const message = typeof b?.message === "string" ? b.message.trim() : "";
  const subject = ((typeof b?.subject === "string" ? b.subject.trim() : "") || "פנייה מ־Yalle").slice(0, 160);
  if (message.length < 3 || message.length > 4000) {
    return NextResponse.json({ error: "bad_message" }, { status: 400 });
  }
  const page = typeof b?.page === "string" ? b.page.slice(0, 300) : null;
  const from = user.email;

  // Backup first — never lose a message.
  await addFeedback({
    kind: "contact",
    message: `נושא: ${subject}\n\n${message}`,
    email: from,
    page,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  }).catch(() => {});

  // Email the team (best-effort; inert until RESEND_API_KEY is set).
  let emailed = false;
  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [TO],
          reply_to: from,
          subject: `[Yalle · צור קשר] ${subject} — ${from}`,
          text: `פנייה חדשה דרך טופס יצירת הקשר של Yalle\n\nמאת: ${from}\nעמוד: ${page ?? "-"}\n\n${message}`,
        }),
      });
      emailed = res.ok;
      if (!res.ok) console.warn(`[contact] resend failed: ${res.status} ${await res.text().catch(() => "")}`);
    } catch (e) {
      console.warn(`[contact] resend error: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, emailed });
}
