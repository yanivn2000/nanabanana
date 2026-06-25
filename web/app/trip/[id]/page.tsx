import Link from "next/link";
import { SAMPLE_TRIP, KIND_META, type Stop } from "@/lib/sample";
import {
  ChevronRight, Mountain, Utensils, Landmark, Coffee, ShoppingBag,
  Sparkles, Star, Users, Car, Wallet,
} from "lucide-react";
import { AskBar } from "./AskBar";

const ICONS = {
  mountain: Mountain, utensils: Utensils, landmark: Landmark,
  coffee: Coffee, "shopping-bag": ShoppingBag,
} as const;

function StopIcon({ kind }: { kind: Stop["kind"] }) {
  const meta = KIND_META[kind];
  const Icon = ICONS[meta.icon as keyof typeof ICONS] ?? Coffee;
  return (
    <div
      className="grid size-10 shrink-0 place-items-center rounded-[12px]"
      style={{ background: meta.soft, color: meta.color }}
    >
      <Icon size={19} />
    </div>
  );
}

export default function TripPage() {
  const trip = SAMPLE_TRIP;

  return (
    <main className="mx-auto max-w-[440px] pb-32">
      {/* hero header */}
      <header className="rise bg-[var(--brand)] px-5 pb-7 pt-7 text-white">
        <Link href="/" className="mb-4 flex items-center gap-1 text-[13px] text-[var(--brand-soft)]">
          <ChevronRight size={16} /> הטיולים שלי
        </Link>
        <p className="text-[13px] text-[var(--brand-soft)]">{trip.travellers}</p>
        <h1 className="mt-1 text-[27px] font-bold leading-tight">
          {trip.title} {trip.cover}
        </h1>
        <p className="mt-1 text-sm text-[var(--brand-soft)]">
          {trip.subtitle} · {trip.days} ימים
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {trip.tags.map((t, i) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[12px]"
            >
              {[<Mountain key="0" size={13} />, <Users key="1" size={13} />, <Car key="2" size={13} />, <Wallet key="3" size={13} />][i]}
              {t}
            </span>
          ))}
        </div>
      </header>

      {/* itinerary days */}
      <div className="px-5">
        {trip.itinerary.map((day, di) => (
          <section key={day.label} className={`rise rise-${Math.min(di + 1, 4)} mt-7`}>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[15px] font-bold">{day.label}</span>
              <span className="text-[13px] text-[var(--text-3)]">· {day.date} · {day.base}</span>
            </div>

            <div className="flex flex-col gap-2.5">
              {day.stops.map((s) => (
                <div
                  key={s.name}
                  className="flex items-start gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]"
                >
                  <StopIcon kind={s.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[15px] font-medium leading-tight">{s.name}</p>
                      {s.score && (
                        <span className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-[var(--brand-ink)]">
                          <Star size={13} fill="currentColor" /> {s.score}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] text-[var(--text-3)]">
                      {s.time} · {s.duration}
                    </p>
                    {s.note && (
                      <p className="mt-1.5 text-[13px] leading-snug text-[var(--text-2)]">{s.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {day.why && (
              <div className="mt-3 flex gap-2.5 rounded-[var(--radius-card)] bg-[var(--brand-soft)] p-3.5">
                <Sparkles size={17} className="mt-0.5 shrink-0 text-[var(--brand-ink)]" />
                <p className="text-[13px] leading-snug text-[var(--brand-ink)]">
                  <span className="font-bold">למה ככה: </span>
                  {day.why}
                </p>
              </div>
            )}
          </section>
        ))}
      </div>

      <AskBar />
    </main>
  );
}
