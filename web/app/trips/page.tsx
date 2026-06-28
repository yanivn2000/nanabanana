"use client";

import { useState } from "react";
import Link from "next/link";
import { useProfile, profileSummary, useTrips } from "@/lib/store";
import { Plus, ArrowLeft, Trash2, Sparkles, BedDouble } from "lucide-react";
import { NewTrip } from "./NewTrip";

export default function TripsPage() {
  const [p, , profileLoaded] = useProfile();
  const { trips, remove, loaded } = useTrips();
  const [creating, setCreating] = useState(false);

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-8 lg:max-w-5xl lg:px-8 lg:pb-12">
      <header className="rise mb-5">
        <p className="eyebrow">הטיולים שלי</p>
        <h1 className="serif mt-1 text-[32px] leading-none lg:text-[40px]">המסעות שלי</h1>
        {profileLoaded && (
          <p className="mt-2 text-[13px] text-[var(--text-2)]">{profileSummary(p)}</p>
        )}
      </header>

      {!creating && (
        <button onClick={() => setCreating(true)}
          className="rise rise-1 mb-5 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[var(--accent)] py-4 text-[15px] font-medium text-white shadow-[var(--shadow)] lg:max-w-xs">
          <Plus size={18} /> טיול חדש
        </button>
      )}

      {creating && <NewTrip onClose={() => setCreating(false)} />}

      {loaded && trips.length === 0 && !creating && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
          <p className="text-[15px] font-medium">עוד אין טיולים</p>
          <p className="mt-1 text-[13px] text-[var(--text-2)]">צרו טיול ראשון — לפי העדפות או לפי מלונות שכבר הזמנתם.</p>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
        {trips.map((t) => (
          <div key={t.id}
            className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
            <div className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
              {t.mode === "hotels" ? <BedDouble size={20} /> : <Sparkles size={20} />}
            </div>
            <Link href={`/trip/${t.id}`} className="min-w-0 flex-1">
              <p className="serif truncate text-[18px] leading-tight">{t.title}</p>
              <p className="mt-0.5 text-[13px] text-[var(--text-2)]">
                {t.cityHe || t.city ? `${t.cityHe || t.city} · ` : ""}{t.days} ימים
                {t.itinerary ? " · לו\"ז מוכן" : " · טרם נבנה"}
              </p>
            </Link>
            <button onClick={() => { if (confirm(`למחוק את "${t.title}"?`)) remove(t.id); }}
              aria-label="מחק" className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--text-3)]">
              <Trash2 size={17} />
            </button>
            <Link href={`/trip/${t.id}`} aria-label="פתח"
              className="grid size-9 shrink-0 place-items-center text-[var(--text-3)]">
              <ArrowLeft size={18} />
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}
