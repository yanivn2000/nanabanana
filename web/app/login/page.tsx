"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, Loader2, CheckCircle2, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function sendLink() {
    const e = email.trim();
    if (!e || !e.includes("@")) { setMsg("הזינו כתובת מייל תקינה"); setStatus("error"); return; }
    setStatus("sending"); setMsg("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setStatus("sent");
  }

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-12 lg:pt-20">
      <Link href="/" className="eyebrow mb-4 inline-flex items-center gap-1">
        <ChevronRight size={14} /> בית
      </Link>
      <h1 className="serif text-[32px] leading-none lg:text-[40px]">התחברות</h1>
      <p className="mt-3 text-[14px] text-[var(--text-2)]">
        נשלח לכם קישור כניסה למייל — בלי סיסמאות. הטיולים שלכם נשמרים לחשבון ומחכים בכל מכשיר.
      </p>

      {status === "sent" ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 text-center shadow-[var(--shadow)]">
          <CheckCircle2 size={28} className="mx-auto text-[var(--accent-ink)]" />
          <p className="serif mt-3 text-[18px]">בדקו את המייל</p>
          <p className="mt-1 text-[13px] text-[var(--text-2)]">
            שלחנו קישור כניסה ל-<span className="font-medium text-[var(--text)]">{email.trim()}</span>.
            לחצו עליו כדי להתחבר.
          </p>
          <button onClick={() => setStatus("idle")}
            className="mt-4 text-[13px] text-[var(--accent-ink)]">מייל אחר</button>
        </div>
      ) : (
        <div className="mt-6">
          <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5 pr-4 shadow-[var(--shadow)]">
            <Mail size={17} className="text-[var(--text-3)]" />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLink()}
              type="email" inputMode="email" placeholder="האימייל שלכם"
              dir="ltr"
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-3)]"
            />
          </div>
          {status === "error" && <p className="mt-2 text-[12.5px] text-[var(--amber)]">{msg}</p>}
          <button onClick={sendLink} disabled={status === "sending"}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3 text-[15px] font-medium text-white disabled:opacity-50">
            {status === "sending" ? <Loader2 size={17} className="animate-spin" /> : <Mail size={17} />}
            שלחו לי קישור כניסה
          </button>
          <p className="mt-4 text-[12px] text-[var(--text-3)]">
            אפשר להמשיך לדפדף בלי חשבון — התחברות נדרשת רק כדי לשמור טיולים.
          </p>
        </div>
      )}
    </main>
  );
}
