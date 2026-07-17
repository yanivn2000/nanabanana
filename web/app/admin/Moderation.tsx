"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, EyeOff, Eye, ExternalLink } from "lucide-react";
import type { ModerationComment, ModerationTrip } from "@/lib/db";

// Team moderation queue: reported or already-hidden comments + trips, with
// one-click hide/unhide. Hidden content disappears from every public read.
export function Moderation() {
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<ModerationComment[]>([]);
  const [trips, setTrips] = useState<ModerationTrip[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/moderation");
      const data = await res.json();
      setComments(data.comments ?? []); setTrips(data.trips ?? []);
    } finally { setLoading(false); }
  }

  async function toggleComment(id: number, hidden: boolean) {
    setBusy(`c${id}`);
    await fetch("/api/admin/moderation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "comment", id, hidden }),
    });
    setComments((cs) => cs.map((c) => c.id === id ? { ...c, hidden } : c));
    setBusy(null);
  }
  async function toggleTrip(slug: string, hidden: boolean) {
    setBusy(`t${slug}`);
    await fetch("/api/admin/moderation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "trip", slug, hidden }),
    });
    setTrips((ts) => ts.map((t) => t.slug === slug ? { ...t, hidden } : t));
    setBusy(null);
  }

  if (loading) return <p className="flex items-center gap-2 py-8 text-[14px] text-[var(--text-2)]"><Loader2 size={16} className="animate-spin" /> טוען תור מודרציה…</p>;

  const empty = comments.length === 0 && trips.length === 0;
  return (
    <section className="py-4">
      {empty && (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center text-[14px] text-[var(--text-2)]">
          אין דיווחים ✨ — התור נקי.
        </p>
      )}

      {trips.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-[15px] font-bold">טיולים שדווחו ({trips.length})</h3>
          <div className="flex flex-col gap-2">
            {trips.map((t) => (
              <div key={t.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-sm)] border p-3"
                style={{ borderColor: t.hidden ? "#c0453f" : "var(--border)", background: t.hidden ? "rgba(192,69,63,.05)" : "var(--surface)" }}>
                <Link href={`/t/${t.slug}`} target="_blank" className="flex items-center gap-1 text-[14px] font-semibold text-[var(--brand-ink)]">
                  {t.title} <ExternalLink size={12} />
                </Link>
                <span className="text-[12.5px] text-[var(--text-3)]">{t.city_he} · 🚩 {t.reported} · ❤️ {t.likes} · 👁 {t.views}</span>
                {t.hidden && <span className="rounded-full bg-[#c0453f] px-2 py-0.5 text-[11px] text-white">מוסתר</span>}
                <button onClick={() => toggleTrip(t.slug, !t.hidden)} disabled={busy === `t${t.slug}`}
                  className="mr-auto flex items-center gap-1 rounded-full border px-3 py-1 text-[12.5px] font-medium"
                  style={{ borderColor: t.hidden ? "var(--brand)" : "#c0453f", color: t.hidden ? "var(--brand-ink)" : "#c0453f" }}>
                  {t.hidden ? <><Eye size={13} /> החזירו</> : <><EyeOff size={13} /> הסתירו</>}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {comments.length > 0 && (
        <div>
          <h3 className="mb-2 text-[15px] font-bold">תגובות שדווחו ({comments.length})</h3>
          <div className="flex flex-col gap-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-[var(--radius-sm)] border p-3"
                style={{ borderColor: c.hidden ? "#c0453f" : "var(--border)", background: c.hidden ? "rgba(192,69,63,.05)" : "var(--surface)" }}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--text-3)]">
                  <span className="font-semibold text-[var(--text)]">{c.author_name}</span>
                  <span>🚩 {c.reported}</span>
                  <Link href={`/t/${c.slug}`} target="_blank" className="flex items-center gap-0.5 text-[var(--brand-ink)]">
                    {c.trip_title} <ExternalLink size={11} />
                  </Link>
                  {c.hidden && <span className="rounded-full bg-[#c0453f] px-2 py-0.5 text-[11px] text-white">מוסתר</span>}
                  <button onClick={() => toggleComment(c.id, !c.hidden)} disabled={busy === `c${c.id}`}
                    className="mr-auto flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-medium"
                    style={{ borderColor: c.hidden ? "var(--brand)" : "#c0453f", color: c.hidden ? "var(--brand-ink)" : "#c0453f" }}>
                    {c.hidden ? <><Eye size={12} /> החזירו</> : <><EyeOff size={12} /> הסתירו</>}
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
