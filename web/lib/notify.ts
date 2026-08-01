// Best-effort team-notification email via Resend's REST API (no SDK dependency).
// Inert — returns {emailed:false, reason:"no_key"} — until RESEND_API_KEY is set.
// Shared by the contact form and the feedback widget so both reach the team inbox.
//
// Default recipient is yaniv@eos-online.com because the default sender is Resend's
// shared onboarding@resend.dev, which only delivers to the Resend account owner's
// address. Verify yalle.co in Resend, set CONTACT_FROM to a yalle.co address, then
// CONTACT_TO can be any inbox (e.g. support@eos-online.com).
const TO = process.env.CONTACT_TO || "yaniv@eos-online.com";
const FROM = process.env.CONTACT_FROM || "Yalle <onboarding@resend.dev>";

export function contactConfig() {
  return { hasKey: Boolean(process.env.RESEND_API_KEY), to: TO, from: FROM };
}

export async function sendTeamEmail(opts: {
  subject: string;
  text: string;
  replyTo?: string | null;
}): Promise<{ emailed: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { emailed: false, reason: "no_key" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        subject: opts.subject,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[notify] resend failed: ${res.status} ${detail}`);
      return { emailed: false, reason: `send_failed_${res.status}` };
    }
    return { emailed: true };
  } catch (e) {
    console.warn(`[notify] resend error: ${(e as Error).message}`);
    return { emailed: false, reason: "send_error" };
  }
}
