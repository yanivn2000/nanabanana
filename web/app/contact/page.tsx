"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Mail, LogIn, Loader2, ArrowRight, CheckCircle2 } from "lucide-react";

export default function ContactPage() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setEmail(s?.user?.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function send() {
    if (message.trim().length < 3) { setErr("כתבו הודעה קצת יותר ארוכה"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message: message.trim(), page: "/contact" }),
      });
      if (res.status === 401) { setEmail(null); setErr("צריך להתחבר כדי לשלוח"); return; }
      if (!res.ok) { setErr("השליחה נכשלה — נסו שוב בעוד רגע"); return; }
      setSent(true);
    } catch {
      setErr("השליחה נכשלה — נסו שוב בעוד רגע");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[560px] px-6 pb-24 pt-10 lg:pt-14">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-[14px] text-[var(--text-2)] transition hover:text-[var(--brand-ink)]">
        <ArrowRight size={15} /> חזרה לאתר
      </Link>
      <h1 className="serif text-[30px] font-bold leading-tight lg:text-[36px]">צרו קשר</h1>
      <p className="mt-2 text-[16px] leading-relaxed text-[var(--text-2)]">
        שאלה, בעיה או רעיון? נשמח לשמוע. נחזור אליכם לכתובת שאיתה התחברתם.
      </p>

      {email === undefined ? (
        <div className="mt-8 flex justify-center py-10 text-[var(--text-3)]"><Loader2 className="animate-spin" /></div>
      ) : sent ? (
        <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--brand-soft)] p-6 text-center">
          <CheckCircle2 className="mx-auto mb-2 text-[var(--brand)]" />
          <p className="text-[16px] font-medium text-[var(--brand-ink)]">ההודעה נשלחה — תודה!</p>
          <p className="mt-1 text-[14px] text-[var(--text-2)]">נחזור אליכם ל־{email}.</p>
          <Link href="/" className="mt-4 inline-block text-[14px] text-[var(--brand-ink)] underline">חזרה לדף הבית</Link>
        </div>
      ) : !email ? (
        // Gated — contact is for logged-in users so we know who's writing and can reply.
        <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--shadow)]">
          <Mail className="mx-auto mb-3 text-[var(--text-3)]" />
          <p className="text-[16px] font-medium">כדי לשלוח פנייה צריך להתחבר</p>
          <p className="mt-1 text-[14px] text-[var(--text-2)]">כך נדע מי כתב ונוכל לחזור אליכם ישירות.</p>
          <Link href="/login?next=/contact"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-5 py-2.5 text-[15px] font-medium text-white">
            <LogIn size={16} /> התחברות
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          <div>
            <label className="mb-1 block text-[13px] text-[var(--text-3)]">מאת</label>
            <input value={email} readOnly dir="ltr"
              className="w-full cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[15px] text-[var(--text-2)] outline-none" />
          </div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="נושא (לא חובה)"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[15px] outline-none focus:border-[var(--brand)]" />
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} placeholder="ההודעה שלכם…"
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[15px] outline-none focus:border-[var(--brand)]" />
          {err && <p className="text-[13.5px] text-[var(--error)]">{err}</p>}
          <button onClick={send} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3 text-[15px] font-medium text-white transition hover:bg-[var(--brand-hover)] disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            {busy ? "שולח…" : "שליחה"}
          </button>
        </div>
      )}
    </main>
  );
}
