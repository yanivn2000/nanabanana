import Link from "next/link";
import { listDestinations } from "@/lib/db";
import { SAMPLE_TRIP } from "@/lib/sample";
import { MapPin, ArrowLeft, Plus, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default function Home() {
  const destinations = listDestinations();

  return (
    <main className="mx-auto max-w-[440px] px-5 pb-24 pt-8">
      {/* header */}
      <header className="rise mb-7 flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--text-2)]">ערב טוב, יניב 👋</p>
          <h1 className="mt-0.5 text-[26px] font-bold leading-tight">לאן טסים?</h1>
        </div>
        <div className="grid size-11 place-items-center rounded-full bg-[var(--brand-soft)] text-xl">
          🍌
        </div>
      </header>

      {/* hero CTA */}
      <Link
        href="/trip/austria-family"
        className="rise rise-1 block rounded-[var(--radius-card)] bg-[var(--brand)] p-5 text-white shadow-[var(--shadow)]"
      >
        <div className="flex items-center gap-2 text-[13px] text-[var(--brand-soft)]">
          <Sparkles size={15} /> ממשיכים מאיפה שעצרתם
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <p className="text-[22px] font-bold leading-tight">{SAMPLE_TRIP.title}</p>
            <p className="mt-1 text-sm text-[var(--brand-soft)]">
              {SAMPLE_TRIP.subtitle} · {SAMPLE_TRIP.days} ימים
            </p>
          </div>
          <span className="text-4xl">{SAMPLE_TRIP.cover}</span>
        </div>
      </Link>

      {/* new trip */}
      <button className="rise rise-2 mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] py-4 text-[15px] font-medium text-[var(--text-2)]">
        <Plus size={18} /> טיול חדש
      </button>

      {/* destinations from the real DB */}
      <section className="rise rise-3 mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[17px] font-bold">יעדים פופולריים לישראלים</h2>
          {destinations.length > 0 && (
            <span className="text-xs text-[var(--text-3)]">{destinations.length} יעדים</span>
          )}
        </div>

        {destinations.length === 0 ? (
          <div className="rounded-[var(--radius-card)] bg-[var(--surface)] p-5 text-center text-sm text-[var(--text-2)]">
            עדיין אין נתונים — הריצו איסוף בכלי הניהול.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {destinations.map((d) => (
              <Link
                href={`/destination/${d.id}`}
                key={d.id}
                className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]"
              >
                <div className="grid size-11 place-items-center rounded-[var(--radius-sm)] bg-[var(--brand-soft)] text-[var(--brand-ink)]">
                  <MapPin size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{d.city}</p>
                  <p className="text-[13px] text-[var(--text-2)]">
                    {d.country} · {d.attraction_count.toLocaleString("he")} אטרקציות
                  </p>
                </div>
                <ArrowLeft size={18} className="text-[var(--text-3)]" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
