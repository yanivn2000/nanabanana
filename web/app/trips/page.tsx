"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useProfile, profileSummary, useTrips } from "@/lib/store";
import { Plus, ArrowLeft, Trash2, Sparkles, BedDouble } from "lucide-react";
import { NewTrip } from "./NewTrip";
import { SuitcaseArt } from "@/components/Illustrations";
import { CityPoster } from "@/components/CityPoster";

export default function TripsPage() {
  const [p, , profileLoaded] = useProfile();
  const { trips, remove, loaded } = useTrips();
  const [creating, setCreating] = useState(false);

  // Open the new-trip form straight away when arrived via "טיול חדש" (?new=1).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setCreating(true);
  }, []);

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-8 lg:max-w-5xl lg:px-8 lg:pb-12">
      <header className="rise mb-5">
        <h1 className="serif text-[32px] font-bold leading-none lg:text-[40px]">הטיולים שלי</h1>
        {profileLoaded && (
          <p className="mt-2 text-[14px] text-[var(--text-2)]">{profileSummary(p)}</p>
        )}
      </header>

      {!creating && (
        <button onClick={() => setCreating(true)}
          className="rise rise-1 mb-5 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[var(--brand)] py-4 text-[16px] font-medium text-white shadow-[var(--shadow)] lg:max-w-xs">
          <Plus size={18} /> טיול חדש
        </button>
      )}

      {creating && <NewTrip onClose={() => setCreating(false)} />}

      {loaded && trips.length === 0 && !creating && (
        <div className="flex flex-col items-center rounded-[var(--radius-card)] bg-[var(--surface)] px-5 py-10 text-center shadow-[var(--shadow)]">
          <SuitcaseArt width={210} />
          <p className="serif mt-4 text-[20px] font-bold">המזוודה מוכנה. לאן טסים?</p>
          <p className="mt-1 text-[14px] text-[var(--text-2)]">צרו טיול ראשון — לפי העדפות או לפי מלונות שכבר הזמנתם.</p>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
        {trips.map((t) => (
          <div key={t.id}
            className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
            <div className="relative shrink-0">
              <CityPoster destinationId={t.destinationId} cityHe={t.cityHe || t.city} orientation="landscape"
                className="h-[58px] w-[86px] rounded-[var(--radius-sm)]" />
              <span className="absolute bottom-1 start-1 grid size-5 place-items-center rounded-full bg-[var(--surface)] text-[var(--accent-ink)] shadow-[var(--shadow)]">
                {t.mode === "hotels" ? <BedDouble size={12} /> : <Sparkles size={12} />}
              </span>
            </div>
            <Link href={`/trip/${t.id}`} className="min-w-0 flex-1">
              <p className="serif truncate text-[18px] leading-tight">{t.title}</p>
              <p className="mt-0.5 text-[14px] text-[var(--text-2)]">
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
