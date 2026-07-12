"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail, Loader2, ChevronRight, KeyRound, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const RESEND_SECONDS = 45;

// Turn a raw Supabase auth error into a calm Hebrew line.
function friendly(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("rate limit") || m.includes("too many") || m.includes("exceeded"))
    return "נשלחו יותר מדי מיילים. חכו כמה דקות ונסו שוב — או הזינו קוד שכבר קיבלתם במייל.";
  if (m.includes("expired")) return "הקוד פג תוקף. בקשו קוד חדש.";
  if (m.includes("invalid") || m.includes("token")) return "הקוד שגוי. בדקו את המייל או בקשו קוד חדש.";
  return msg || "אירעה שגיאה. נסו שוב.";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [status, setStatus] = useState<"idle" | "sending" | "verifying">("idle");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // A magic link that failed (e.g. opened on a different device) lands here
  // with ?error=auth — nudge the user toward the device-proof code instead.
  useEffect(() => {
    if (new URLSearchParams(location.search).get("error")) {
      setError("הקישור לא עבד — לרוב זה קורה כשפותחים אותו במכשיר אחר מזה שביקש. הזינו במקום את הקוד בן 6 הספרות מהמייל; הוא עובד מכל מכשיר.");
    }
  }, []);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function send() {
    const e = email.trim();
    if (!e || !e.includes("@")) { setError("הזינו כתובת מייל תקינה"); return; }
    setStatus("sending"); setError("");
    const { error } = await createClient().auth.signInWithOtp({
      email: e,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setStatus("idle");
    if (error) { setError(friendly(error.message)); return; }
    setStep("code"); setCode(""); setCooldown(RESEND_SECONDS);
  }

  async function verify() {
    const token = code.replace(/\D/g, "");
    if (token.length < 6) { setError("הזינו את הקוד בן 6 הספרות מהמייל"); return; }
    setStatus("verifying"); setError("");
    const { error } = await createClient().auth.verifyOtp({
      email: email.trim(), token, type: "email",
    });
    if (error) { setStatus("idle"); setError(friendly(error.message)); return; }
    // Full navigation so the server picks up the fresh session cookie.
    window.location.assign("/trips");
  }

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-12 lg:pt-20">
      <Link href="/" className="eyebrow mb-4 inline-flex items-center gap-1">
        <ChevronRight size={14} /> בית
      </Link>
      <h1 className="serif text-[32px] leading-none lg:text-[40px]">התחברות</h1>
      <p className="mt-3 text-[14px] text-[var(--text-2)]">
        נשלח לכם קוד כניסה למייל — בלי סיסמאות. הטיולים שלכם נשמרים לחשבון ומחכים בכל מכשיר.
      </p>

      {step === "email" ? (
        <div className="mt-6">
          <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5 pr-4 shadow-[var(--shadow)]">
            <Mail size={17} className="text-[var(--text-3)]" />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              type="email" inputMode="email" placeholder="האימייל שלכם"
              dir="ltr" autoFocus
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-3)]"
            />
          </div>
          {error && <p className="mt-2 text-[12.5px] leading-snug text-[var(--amber)]">{error}</p>}
          <button onClick={send} disabled={status === "sending"}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3 text-[15px] font-medium text-white disabled:opacity-50">
            {status === "sending" ? <Loader2 size={17} className="animate-spin" /> : <Mail size={17} />}
            שלחו לי קוד כניסה
          </button>
          <button
            onClick={() => {
              if (!email.trim().includes("@")) { setError("קודם הזינו את המייל שאליו נשלח הקוד"); return; }
              setError(""); setStep("code");
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 text-[13px] text-[var(--brand-ink)]">
            <KeyRound size={14} /> כבר יש לי קוד
          </button>
          <p className="mt-4 text-[12px] text-[var(--text-3)]">
            אפשר להמשיך לדפדף בלי חשבון — התחברות נדרשת רק כדי לשמור טיולים.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]">
            <div className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)]">
              <KeyRound size={22} />
            </div>
            <p className="serif mt-3 text-center text-[18px]">הזינו את הקוד מהמייל</p>
            <p className="mt-1 text-center text-[13px] text-[var(--text-2)]">
              שלחנו קוד בן 6 ספרות ל-<span className="font-medium text-[var(--text)]" dir="ltr">{email.trim()}</span>
            </p>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              inputMode="numeric" autoComplete="one-time-code" placeholder="______"
              dir="ltr" autoFocus maxLength={6}
              className="mt-4 w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] py-3 text-center font-mono text-[26px] tracking-[0.4em] text-[var(--text)] outline-none placeholder:text-[var(--text-3)] focus:border-[var(--brand)]"
            />
            {error && <p className="mt-2 text-center text-[12.5px] leading-snug text-[var(--amber)]">{error}</p>}

            <button onClick={verify} disabled={status === "verifying"}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3 text-[15px] font-medium text-white disabled:opacity-50">
              {status === "verifying" ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}
              כניסה
            </button>

            <div className="mt-4 flex items-center justify-between text-[12.5px]">
              <button
                onClick={() => { setStep("email"); setError(""); }}
                className="text-[var(--text-3)]">← החלפת מייל</button>
              <button
                onClick={send}
                disabled={cooldown > 0 || status === "sending"}
                className="font-medium text-[var(--brand-ink)] disabled:text-[var(--text-3)]">
                {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown}s` : "שליחת קוד חדש"}
              </button>
            </div>
          </div>
          <p className="mt-4 text-center text-[12px] text-[var(--text-3)]">
            אפשר גם ללחוץ על הקישור שבמייל — אבל רק מאותו מכשיר שביקש אותו. הקוד עובד מכל מכשיר.
          </p>
        </div>
      )}
    </main>
  );
}
