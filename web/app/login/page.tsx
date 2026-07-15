"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail, Loader2, ChevronRight, ArrowRight, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const RESEND_SECONDS = 45;

function friendly(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("rate limit") || m.includes("too many") || m.includes("exceeded"))
    return "נשלחו יותר מדי מיילים. חכו כמה דקות ונסו שוב.";
  if (m.includes("provider") || m.includes("not enabled") || m.includes("unsupported"))
    return "התחברות Google עדיין לא הופעלה בשרת. השתמשו בקישור במייל בינתיים.";
  if (m.includes("expired")) return "הקוד פג תוקף. בקשו קוד חדש.";
  if (m.includes("invalid") || m.includes("token")) return "הקוד שגוי. בדקו את המייל.";
  return msg || "אירעה שגיאה. נסו שוב.";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [view, setView] = useState<"email" | "sent">("email");
  const [status, setStatus] = useState<"idle" | "google" | "sending" | "verifying">("idle");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("error"))
      setError("ההתחברות לא הושלמה. נסו שוב — לחצו על הקישור מאותו מכשיר שביקש אותו.");
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function google() {
    setStatus("google"); setError("");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) { setStatus("idle"); setError(friendly(error.message)); }
    // on success the browser redirects to Google.
  }

  async function sendLink() {
    const e = email.trim();
    if (!e || !e.includes("@")) { setError("הזינו כתובת מייל תקינה"); return; }
    setStatus("sending"); setError("");
    const { error } = await createClient().auth.signInWithOtp({
      email: e,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setStatus("idle");
    if (error) { setError(friendly(error.message)); return; }
    setView("sent"); setCode(""); setCooldown(RESEND_SECONDS);
  }

  async function verify() {
    const token = code.replace(/\D/g, "");
    if (token.length < 6) { setError("הזינו את הקוד בן 6 הספרות מהמייל"); return; }
    setStatus("verifying"); setError("");
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token, type: "email" });
    if (error) { setStatus("idle"); setError(friendly(error.message)); return; }
    window.location.assign("/trips");
  }

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-12 lg:pt-20">
      <Link href="/" className="eyebrow mb-4 inline-flex items-center gap-1">
        <ChevronRight size={14} /> בית
      </Link>
      <h1 className="serif text-[32px] leading-none lg:text-[40px]">התחברות</h1>
      <p className="mt-3 text-[15px] text-[var(--text-2)]">
        התחברו כדי לשמור את הטיולים שלכם ולגשת אליהם מכל מכשיר.
      </p>

      {view === "email" ? (
        <div className="mt-6">
          {/* Google — primary */}
          <button onClick={google} disabled={status !== "idle"}
            className="flex w-full items-center justify-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--surface)] py-3 text-[16px] font-medium shadow-[var(--shadow)] disabled:opacity-50">
            {status === "google" ? <Loader2 size={18} className="animate-spin" /> : <GoogleMark />}
            המשך עם Google
          </button>

          <div className="my-5 flex items-center gap-3 text-[13px] text-[var(--text-3)]">
            <span className="h-px flex-1 bg-[var(--border)]" /> או במייל <span className="h-px flex-1 bg-[var(--border)]" />
          </div>

          {/* Email magic link */}
          <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5 pr-4 shadow-[var(--shadow)]">
            <Mail size={17} className="text-[var(--text-3)]" />
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLink()}
              type="email" inputMode="email" placeholder="האימייל שלכם" dir="ltr"
              className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]" />
          </div>
          {error && <p className="mt-2 text-[13.5px] leading-snug text-[var(--amber)]">{error}</p>}
          <button onClick={sendLink} disabled={status === "sending"}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3 text-[16px] font-medium text-white disabled:opacity-50">
            {status === "sending" ? <Loader2 size={17} className="animate-spin" /> : <Mail size={17} />}
            שלחו לי קישור כניסה
          </button>
          <p className="mt-4 text-[13px] text-[var(--text-3)]">
            אפשר להמשיך לדפדף בלי חשבון — התחברות נדרשת רק כדי לשמור טיולים.
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]">
          <div className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)]">
            <MailCheck size={22} />
          </div>
          <p className="serif mt-3 text-center text-[18px]">בדקו את המייל</p>
          <p className="mt-1 text-center text-[14px] text-[var(--text-2)]">
            שלחנו קישור כניסה ל-<span className="font-medium text-[var(--text)]" dir="ltr">{email.trim()}</span>.
            לחצו עליו <span className="font-medium">מאותו מכשיר</span> כדי להיכנס.
          </p>

          {/* optional code entry (works once the email template includes a code) */}
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="mb-2 text-center text-[13px] text-[var(--text-3)]">קיבלתם קוד בן 6 ספרות? הזינו אותו כאן:</p>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              inputMode="numeric" autoComplete="one-time-code" placeholder="______" dir="ltr" maxLength={6}
              className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] py-2.5 text-center font-mono text-[22px] tracking-[0.4em] outline-none placeholder:text-[var(--text-3)] focus:border-[var(--brand)]" />
            {error && <p className="mt-2 text-center text-[13.5px] text-[var(--amber)]">{error}</p>}
            <button onClick={verify} disabled={status === "verifying" || code.length < 6}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-2.5 text-[15px] font-medium text-white disabled:opacity-40">
              {status === "verifying" ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} כניסה
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between text-[13.5px]">
            <button onClick={() => { setView("email"); setError(""); }} className="text-[var(--text-3)]">← חזרה</button>
            <button onClick={sendLink} disabled={cooldown > 0 || status === "sending"}
              className="font-medium text-[var(--brand-ink)] disabled:text-[var(--text-3)]">
              {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown}s` : "שליחת קישור חדש"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// Google "G" mark (inline SVG — no external asset).
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7C43.9 37.9 46.5 31.8 46.5 24.5z"/>
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.8-6.1z"/>
      <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7.3-5.7c-2 1.4-4.7 2.3-8 2.3-6.3 0-11.7-3.7-13.6-9.3l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/>
    </svg>
  );
}
