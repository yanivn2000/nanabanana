"use client";

import Link from "next/link";
import { Plus, Sparkles, BedDouble } from "lucide-react";
import { useTrips } from "@/lib/store";
import { CityPoster } from "@/components/CityPoster";
import { SuitcaseArt } from "@/components/Illustrations";

// Home entry to "הטיולים שלי": a preview of the traveler's real trips (not a
// redundant link to /trips) + one "new trip" action. Client-side (trips live in
// localStorage). Empty state invites the first trip.
export function HomeTrips() {
  const { trips, loaded } = useTrips();

  if (!loaded) {
    return <div className="rise h-[104px] rounded-[var(--radius-card)] bg-[var(--surface)] shadow-[var(--shadow)]" />;
  }

  if (trips.length === 0) {
    return (
      <div className="rise flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
        <SuitcaseArt width={104} />
        <div className="min-w-0 flex-1">
          <p className="serif text-[19px] font-bold leading-tight">מוכנים לצאת לדרך?</p>
          <p className="mt-0.5 text-[13px] text-[var(--text-2)]">בנו את הטיול הראשון — לפי העדפות או לפי מלונות שכבר הזמנתם.</p>
          <Link href="/trips"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-[13.5px] font-medium text-white">
            <Plus size={15} /> טיול חדש
          </Link>
        </div>
      </div>
    );
  }

  const recent = trips.slice(0, 2);
  return (
    <div className="rise">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="serif text-[20px] font-bold">הטיולים שלי</h2>
        <Link href="/trips" className="text-[13px] font-medium text-[var(--brand-ink)]">כל הטיולים ←</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {recent.map((t) => (
          <Link key={t.id} href={`/trip/${t.id}`}
            className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow)]">
            <div className="relative shrink-0">
              <CityPoster destinationId={t.destinationId} cityHe={t.cityHe || t.city} orientation="portrait"
                className="h-16 w-[58px] rounded-[var(--radius-sm)]" />
              <span className="absolute bottom-1 start-1 grid size-5 place-items-center rounded-full bg-[var(--surface)] text-[var(--accent-ink)] shadow-[var(--shadow)]">
                {t.mode === "hotels" ? <BedDouble size={12} /> : <Sparkles size={12} />}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="serif truncate text-[16px] font-semibold">{t.title}</p>
              <p className="mt-0.5 text-[12.5px] text-[var(--text-2)]">
                {t.cityHe || t.city ? `${t.cityHe || t.city} · ` : ""}{t.days} ימים
                {t.itinerary ? " · לו\"ז מוכן" : " · טרם נבנה"}
              </p>
            </div>
          </Link>
        ))}
        <Link href="/trips"
          className="flex min-h-[84px] items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-[14px] font-medium text-[var(--brand-ink)]">
          <Plus size={17} /> טיול חדש
        </Link>
      </div>
    </div>
  );
}
