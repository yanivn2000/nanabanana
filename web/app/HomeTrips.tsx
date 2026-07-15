"use client";

import Link from "next/link";
import { Plus, Sparkles, BedDouble, Compass } from "lucide-react";
import { useTrips } from "@/lib/store";
import { CityPoster } from "@/components/CityPoster";

// Home entry to "הטיולים שלי": a compact single row of SQUARE tiles — the
// traveler's recent trips, then a "new trip" tile, then the two entry CTAs
// ("לא יודעים לאן?" / "אני בטיול עכשיו") in their palette colours, so the whole
// row sits high on the page and the destinations below peek above the fold.
// Client-side (trips live in localStorage).
export function HomeTrips() {
  const { trips, loaded } = useTrips();

  // one horizontal, scroll-on-overflow row of fixed square tiles
  const Row = ({ children }: { children: React.ReactNode }) => (
    <div className="-mx-5 grid grid-flow-col auto-cols-[150px] gap-3 overflow-x-auto px-5 pb-1 lg:mx-0 lg:auto-cols-[176px] lg:px-0"
         style={{ scrollbarWidth: "none" }}>
      {children}
    </div>
  );

  const NewTile = (
    <Link href="/trips?new=1"
      className="flex aspect-square flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--border)] bg-[var(--surface)] text-[var(--brand-ink)] transition hover:border-[var(--brand)]">
      <Plus size={22} /> <span className="text-[15px] font-medium">טיול חדש</span>
    </Link>
  );

  // The two standing entry points, as square tiles in their palette colours.
  const CtaTile = ({ href, bg, ink, Icon, title, sub }: {
    href: string; bg: string; ink: string; Icon: typeof Sparkles; title: string; sub: string;
  }) => (
    <Link href={href}
      className="flex aspect-square flex-col justify-between rounded-[var(--radius-card)] border border-[var(--border)] p-3.5 shadow-[var(--shadow)] transition hover:-translate-y-0.5"
      style={{ background: bg }}>
      <span className="grid size-10 place-items-center rounded-full bg-[var(--surface)]" style={{ color: ink }}>
        <Icon size={20} />
      </span>
      <span>
        <span className="block text-[16px] font-semibold" style={{ color: ink }}>{title}</span>
        <span className="mt-0.5 block text-[13.5px] text-[var(--text-2)]">{sub}</span>
      </span>
    </Link>
  );

  const ctas = (
    <>
      <CtaTile href="/recommend" bg="var(--accent-soft)" ink="var(--accent-ink)"
        Icon={Sparkles} title="לא יודעים לאן?" sub="המלצת יעד לפי המשפחה" />
      <CtaTile href="/now" bg="var(--brand-soft)" ink="var(--brand-ink)"
        Icon={Compass} title="אני בטיול עכשיו" sub="מה קרוב אליי + ניווט" />
    </>
  );

  const Head = (
    <div className="mb-2.5 flex items-baseline justify-between">
      <h2 className="text-[14.5px] font-semibold text-[var(--text-2)]">הטיולים שלי</h2>
      <Link href="/trips" className="text-[14px] font-medium text-[var(--brand-ink)]">כל הטיולים ←</Link>
    </div>
  );

  if (!loaded) {
    return (
      <div className="rise">
        {Head}
        <Row>{NewTile}{ctas}</Row>
      </div>
    );
  }

  const recent = trips.slice(0, 3);
  return (
    <div className="rise">
      {Head}
      <Row>
        {recent.map((t) => (
          <Link key={t.id} href={`/trip/${t.id}`}
            className="group relative block aspect-square overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow)]">
            <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.05]">
              <CityPoster destinationId={t.destinationId} cityHe={t.cityHe || t.city} overlay
                orientation="landscape" position="50% 45%" className="size-full" />
            </div>
            <span className="absolute start-2 top-2 grid size-6 place-items-center rounded-full bg-[var(--surface)]/92 text-[var(--accent-ink)] shadow-sm backdrop-blur">
              {t.mode === "hotels" ? <BedDouble size={13} /> : <Sparkles size={13} />}
            </span>
            <div className="absolute inset-0 flex flex-col justify-end p-3 text-white">
              <p className="serif text-[16px] font-bold leading-tight drop-shadow">{t.title}</p>
              <p className="mt-0.5 text-[13px] text-white/85 drop-shadow">
                {t.cityHe || t.city ? `${t.cityHe || t.city} · ` : ""}{t.days} ימים
                {t.itinerary ? " · מוכן" : ""}
              </p>
            </div>
          </Link>
        ))}
        {NewTile}
        {ctas}
      </Row>
    </div>
  );
}
