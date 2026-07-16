"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Loader2, Check } from "lucide-react";

const KINDS = [
  { v: "bug", t: "🐞 מצאתי באג" },
  { v: "idea", t: "💡 רעיון לשיפור" },
  { v: "other", t: "💬 משהו אחר" },
];

// "מצאתם באג? יש רעיון?" — a tiny feedback form, open to every user. Writes to
// the feedback table via POST /api/feedback; the team reads it in /admin.
// variant="nav" is the desktop TopNav pill; variant="tab" is a BottomNav item.
export function FeedbackWidget({ variant = "nav" }: { variant?: "nav" | "tab" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("idea");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit() {
    if (message.trim().length < 3 || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message: message.trim(), email: email.trim() || null, page: pathname }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      setMessage(""); setEmail("");
      window.setTimeout(() => { setOpen(false); setState("idle"); }, 1600);
    } catch {
      setState("error");
    }
  }

  const trigger = variant === "tab" ? (
    <button onClick={() => setOpen(true)}
      className="flex flex-1 flex-col items-center gap-1 py-1.5" style={{ color: "var(--text-3)" }}>
      <MessageCircle size={22} strokeWidth={2} />
      <span className="whitespace-nowrap text-[12px]">משוב</span>
    </button>
  ) : (
    <button onClick={() => setOpen(true)}
      className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[14px] text-[var(--text-2)] transition hover:bg-[var(--surface-2)]">
      <MessageCircle size={17} /> משוב
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-5" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-[var(--radius-card)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="serif text-[19px] font-bold">מצאתם באג? יש רעיון?</h3>
              <button onClick={() => setOpen(false)} aria-label="סגור" className="text-[var(--text-3)]"><X size={18} /></button>
            </div>
            {state === "sent" ? (
              <p className="flex items-center gap-2 py-6 text-[15px] font-medium text-[var(--brand-ink)]">
                <Check size={18} className="text-[var(--brand)]" /> תודה! קיבלנו — זה עוזר לנו להשתפר.
              </p>
            ) : (
              <>
                <p className="mb-3 text-[13.5px] text-[var(--text-2)]">כמה מילים ואנחנו על זה. אין צורך בפרטים אישיים.</p>
                <div className="mb-3 flex gap-1.5">
                  {KINDS.map((k) => (
                    <button key={k.v} onClick={() => setKind(k.v)}
                      className="flex-1 rounded-full border px-2 py-1.5 text-[12.5px] font-medium transition"
                      style={{ background: kind === k.v ? "var(--brand-soft)" : "var(--surface)",
                               borderColor: kind === k.v ? "var(--brand)" : "var(--border)",
                               color: kind === k.v ? "var(--brand-ink)" : "var(--text-2)" }}>
                      {k.t}
                    </button>
                  ))}
                </div>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} autoFocus
                  placeholder="מה קרה / מה הייתם רוצים לראות?"
                  className="mb-2 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[14px] outline-none focus:border-[var(--brand)]" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr"
                  placeholder="אימייל לתשובה (לא חובה)"
                  className="mb-3 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-right text-[13.5px] outline-none focus:border-[var(--brand)]" />
                {state === "error" && (
                  <p className="mb-2 text-[13px] text-[#c0453f]">משהו השתבש — נסו שוב.</p>
                )}
                <button onClick={submit} disabled={message.trim().length < 3 || state === "sending"}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-2.5 text-[14.5px] font-medium text-white disabled:opacity-50">
                  {state === "sending" ? <Loader2 size={16} className="animate-spin" /> : null} שלחו לנו
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
