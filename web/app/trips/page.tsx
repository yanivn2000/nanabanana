"use client";

import Link from "next/link";
import { useProfile, profileSummary, useTrips, MONTHS_HE, type Trip } from "@/lib/store";
import { MapPin, Trash2, Sparkles, BedDouble } from "lucide-react";
import { SuitcaseArt } from "@/components/Illustrations";
import { CityPoster } from "@/components/CityPoster";

// Dates → a short Hebrew label: an exact range ("3–5 ביולי") when the trip has
// dates, otherwise just the month ("יולי").
function periodLabel(t: Trip): string | null {
  if (t.startDate) {
    const s = new Date(t.startDate), d1 = s.getDate(), m1 = MONTHS_HE[s.getMonth()];
    if (t.endDate) {
      const e = new Date(t.endDate), d2 = e.getDate();
      return e.getMonth() === s.getMonth()
        ? `${d1}–${d2} ב${m1}` : `${d1} ב${m1} – ${d2} ב${MONTHS_HE[e.getMonth()]}`;
    }
    return `${d1} ב${m1}`;
  }
  return t.month ? MONTHS_HE[t.month - 1] : null;
}

export default function TripsPage() {
  const [p, , profileLoaded] = useProfile();
  const { trips, remove, loaded } = useTrips();

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-8 lg:max-w-[1600px] lg:px-8 lg:pb-12">
      <header className="rise mb-5">
        <h1 className="serif text-[32px] font-bold leading-none lg:text-[40px]">הטיולים שלי</h1>
        {profileLoaded && (
          <p className="mt-2 text-[14px] text-[var(--text-2)]">{profileSummary(p)}</p>
        )}
      </header>

      {loaded && trips.length === 0 && (
        <div className="flex flex-col items-center rounded-[var(--radius-card)] bg-[var(--surface)] px-5 py-10 text-center shadow-[var(--shadow)]">
          <SuitcaseArt width={210} />
          <p className="serif mt-4 text-[20px] font-bold">המזוודה מוכנה. לאן טסים?</p>
          <p className="mt-1 text-[14px] text-[var(--text-2)]">בחרו עיר, גלו אטרקציות ושכונות — ונרכיב לכם טיול משם.</p>
          <Link href="/"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-6 py-3 text-[15px] font-medium text-white shadow-[var(--shadow)]">
            <MapPin size={16} /> בחרו עיר
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-5 xl:grid-cols-3">
        {trips.map((t) => (
          <div key={t.id}
            className="group relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow)] transition hover:-translate-y-0.5">
            {/* the whole card opens the trip; the poster fills it (like the home city tile) */}
            <Link href={`/trip/${t.id}`} aria-label={t.title} className="absolute inset-0 block">
              <div className="size-full transition-transform duration-500 group-hover:scale-[1.04]">
                <CityPoster destinationId={t.destinationId} cityHe={t.cityHe || t.city} overlay
                  orientation="landscape" position="50% 45%" className="size-full" />
              </div>
            </Link>
            {/* mode badge (decorative) */}
            <span className="pointer-events-none absolute start-3 top-3 grid size-8 place-items-center rounded-full bg-[var(--surface)]/90 text-[var(--accent-ink)] shadow-sm backdrop-blur">
              {t.mode === "hotels" ? <BedDouble size={15} /> : <Sparkles size={15} />}
            </span>
            {/* delete — sits above the link so it captures its own clicks */}
            <button onClick={() => { if (confirm(`למחוק את "${t.title}"?`)) remove(t.id); }}
              aria-label="מחק"
              className="absolute end-3 top-3 grid size-8 place-items-center rounded-full bg-[var(--surface)]/90 text-[var(--text-3)] shadow-sm backdrop-blur transition hover:text-[#c0453f]">
              <Trash2 size={15} />
            </button>
            {/* info overlaid on the poster's gradient */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-4 text-white">
              <p className="serif text-[21px] font-bold leading-tight drop-shadow">{t.title}</p>
              <p className="text-[13.5px] font-medium text-white/90 drop-shadow">
                {t.cityHe || t.city ? `${t.cityHe || t.city} · ` : ""}{t.days} ימים · {t.itinerary ? "לו\"ז מוכן" : "טרם נבנה"}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
                {periodLabel(t) && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 backdrop-blur">📅 {periodLabel(t)}</span>
                )}
                <span className="rounded-full bg-white/20 px-2 py-0.5 backdrop-blur">👥 {profileSummary(t.profile ?? p)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
