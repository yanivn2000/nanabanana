"use client";

import { useState } from "react";
import { Share2, Copy, Check, Loader2, X, Trash2 } from "lucide-react";
import type { Trip, FamilyProfile } from "@/lib/store";

// "שתפו את הטיול" — publishes a sanitized, read-only copy to a public URL
// (phase 0 of the community layer). Ownership is an anonymous token kept in
// localStorage; publishing again updates the same link. NO personal details
// leave the device: only the itinerary + composition summary (ages, not names).
export function ShareTrip({ trip, profile, onShared }: {
  trip: Trip;
  profile: FamilyProfile;
  onShared: (shared: { slug: string; token: string } | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "publishing" | "done" | "error">("idle");
  const [copied, setCopied] = useState(false);

  if (!trip.itinerary) return null;
  const url = trip.shared ? `${typeof window !== "undefined" ? window.location.origin : ""}/t/${trip.shared.slug}` : null;

  function composition(): string {
    const kids = profile.kids ?? [];
    const parts = [`${profile.adults ?? 2} מבוגרים`];
    if (kids.length) {
      const ages = kids.map((k) => k.age).filter((a) => a != null).sort((a, b) => a - b);
      parts.push(`${kids.length} ילדים${ages.length ? ` (גילאי ${ages.join(", ")})` : ""}`);
    }
    return parts.join(" + ");
  }

  async function publish() {
    setState("publishing");
    try {
      const res = await fetch("/api/trips/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trip.title,
          city: trip.city, city_he: trip.cityHe, country: trip.country,
          destination_id: trip.destinationId,
          days: trip.days, month: trip.month,
          composition: composition(),
          pace: profile.pace,
          itinerary: trip.itinerary,
          remix_of: trip.remixOf ?? null,
          ...(trip.shared ? { slug: trip.shared.slug, owner_token: trip.shared.token } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // remember ownership for the public page (mark comments as helpful)
      try {
        const shares = JSON.parse(localStorage.getItem("nanabanana.shares.v1") ?? "{}");
        shares[data.slug] = data.token;
        localStorage.setItem("nanabanana.shares.v1", JSON.stringify(shares));
      } catch {}
      onShared({ slug: data.slug, token: data.token });
      setState("done");
    } catch { setState("error"); }
  }

  async function unpublish() {
    if (!trip.shared) return;
    if (!window.confirm("להסיר את הקישור הציבורי? מי שקיבל אותו לא יוכל לצפות יותר.")) return;
    await fetch("/api/trips/share", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: trip.shared.slug, owner_token: trip.shared.token }),
    });
    onShared(undefined);
    setState("idle");
  }

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  }

  return (
    <>
      <button onClick={() => { setOpen(true); if (!trip.shared) void publish(); }}
        className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--brand)] px-3.5 py-2 text-[14.5px] font-medium text-[var(--brand-ink)]"
        style={{ background: trip.shared ? "var(--brand-soft)" : "var(--surface)" }}>
        <Share2 size={14} /> {trip.shared ? "משותף" : "שתפו"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-5" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-[var(--radius-card)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="serif text-[19px] font-bold">שיתוף הטיול</h3>
              <button onClick={() => setOpen(false)} aria-label="סגור" className="text-[var(--text-3)]"><X size={18} /></button>
            </div>

            {state === "publishing" && (
              <p className="flex items-center gap-2 py-6 text-[14.5px] text-[var(--text-2)]">
                <Loader2 size={16} className="animate-spin" /> מפרסמים עותק ציבורי…
              </p>
            )}
            {state === "error" && (
              <div className="py-4">
                <p className="mb-3 text-[14px] text-[#c0453f]">הפרסום נכשל — נסו שוב.</p>
                <button onClick={publish} className="rounded-full bg-[var(--brand)] px-5 py-2 text-[14px] text-white">נסו שוב</button>
              </div>
            )}
            {trip.shared && state !== "publishing" && state !== "error" && (
              <>
                <p className="mb-3 text-[13.5px] leading-relaxed text-[var(--text-2)]">
                  קישור ציבורי לקריאה בלבד — מושלם לקבוצות פייסבוק/וואטסאפ. מטיילים יוכלו
                  להגיב על הטיול ולהעתיק אותו; הפרטים האישיים שלכם לא משותפים.
                </p>
                <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-2">
                  <span dir="ltr" className="min-w-0 flex-1 truncate px-1 text-[13px] text-[var(--text-2)]">{url}</span>
                  <button onClick={copy}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-1.5 text-[13px] font-medium text-white">
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "הועתק!" : "העתיקו"}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`https://wa.me/?text=${encodeURIComponent(`${trip.title} — תוכנית יום-אחר-יום עם מפה:\n${url}`)}`}
                    target="_blank" rel="noreferrer"
                    className="rounded-full border border-[var(--brand)] px-4 py-1.5 text-[13px] font-medium text-[var(--brand-ink)]">
                    שתפו בוואטסאפ
                  </a>
                  <button onClick={publish}
                    className="rounded-full border border-[var(--border)] px-4 py-1.5 text-[13px] text-[var(--text-2)]">
                    עדכנו את הגרסה המשותפת
                  </button>
                  <button onClick={unpublish}
                    className="mr-auto flex items-center gap-1 rounded-full px-2 py-1.5 text-[12.5px] text-[var(--text-3)] hover:text-[#c0453f]">
                    <Trash2 size={13} /> הסירו שיתוף
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
