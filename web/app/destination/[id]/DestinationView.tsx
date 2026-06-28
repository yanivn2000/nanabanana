"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Star, Search } from "lucide-react";
import { MapClient } from "@/components/MapClient";
import { descriptor, catColor, bigImage } from "@/lib/labels";
import type { Attraction, Destination } from "@/lib/db";

const CAT_HE: Record<string, string> = {
  nature: "טבע", museum: "מוזיאון", attraction: "אטרקציה", sport: "ספורט",
  food: "אוכל", shopping: "קניות", tourism: "תיירות", leisure: "פנאי", historic: "היסטורי",
};
const SEASON_HE: Record<string, string> = {
  all: "כל השנה", spring: "אביב", summer: "קיץ", autumn: "סתיו", winter: "חורף",
};
const COST_HE = ["חינם", "₪", "₪₪", "₪₪₪"];

function meta(a: Attraction): string {
  const parts = [CAT_HE[a.category] ?? a.category];
  if (a.best_season && SEASON_HE[a.best_season]) parts.push(SEASON_HE[a.best_season]);
  return parts.join(" · ");
}

export function DestinationView({
  dest,
  attractions,
}: {
  dest: Destination;
  attractions: Attraction[];
}) {
  const [selected, setSelected] = useState<Attraction | null>(null);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [flags, setFlags] = useState({
    mustSee: false, free: false, indoor: false, top: false,
  });
  const toggleFlag = (k: keyof typeof flags) =>
    setFlags((f) => ({ ...f, [k]: !f[k] }));

  const cats = useMemo(
    () => Array.from(new Set(attractions.map((a) => a.category))),
    [attractions]
  );
  const filtered = useMemo(
    () =>
      attractions.filter((a) => {
        if (activeCat && a.category !== activeCat) return false;
        if (flags.mustSee && a.must_see !== 1) return false;
        if (flags.free && a.cost_level !== 0) return false;
        if (flags.indoor && !(a.indoor_outdoor === "indoor" || a.indoor_outdoor === "both")) return false;
        if (flags.top && (a.family_score ?? 0) < 8) return false;
        if (query) {
          const hay = `${a.name_he ?? ""} ${a.name_en} ${descriptor(a)}`.toLowerCase();
          if (!hay.includes(query.toLowerCase())) return false;
        }
        return true;
      }),
    [attractions, activeCat, query, flags]
  );

  const mustSee = useMemo(
    () => attractions.filter((a) => a.must_see === 1 && a.image_url).slice(0, 12),
    [attractions]
  );

  return (
    <main className="mx-auto w-full max-w-[440px] pb-28 lg:max-w-none lg:pb-0">
      {/* editorial header */}
      <header className="rise bg-[var(--surface)] px-5 pb-6 pt-8 lg:px-8">
        <Link href="/" className="eyebrow mb-4 inline-flex items-center gap-1 lg:hidden">
          <ChevronRight size={14} /> בית
        </Link>
        <p className="eyebrow">יעד · {dest.country_he || dest.country}</p>
        <h1 className="serif mt-1.5 text-[36px] leading-none lg:text-[44px]">{dest.city_he || dest.city}</h1>
        <div className="rule mt-3"></div>
        <p className="mt-3 text-[13px] text-[var(--text-2)]">
          {dest.attraction_count.toLocaleString("he")} מקומות במאגר
        </p>
      </header>

      {/* editor's picks rail (must-see) */}
      {mustSee.length > 0 && (
        <section className="rise rise-1 border-y border-[var(--border)] bg-[var(--surface-2)] py-5">
          <p className="eyebrow mb-3 px-5 lg:px-8">בחירת העורך · חובה לביקור</p>
          <div className="flex gap-3 overflow-x-auto px-5 pb-1 lg:px-8">
            {mustSee.map((a) => (
              <button key={a.id} onClick={() => setSelected(a)}
                className="group w-[200px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface)] text-right shadow-[var(--shadow)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bigImage(a.image_url, 480)} alt="" loading="lazy"
                  className="h-[150px] w-full object-cover" />
                <div className="p-3">
                  <p className="eyebrow">{meta(a)}</p>
                  <p className="serif mt-1 text-[16px] leading-tight">{a.name_he || a.name_en}</p>
                  {a.tagline_he && (
                    <p className="mt-1 text-[12.5px] italic text-[var(--text-2)]">{a.tagline_he}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="lg:flex lg:items-start">
        {/* map */}
        <div className="sticky top-0 z-10 h-[240px] w-full overflow-hidden border-y border-[var(--border)] lg:order-2 lg:h-[calc(100dvh-57px)] lg:top-[57px] lg:flex-1 lg:border-y-0 lg:border-s">
          <MapClient attractions={filtered} center={[dest.lat, dest.lng]} selected={selected} />
        </div>

        {/* list */}
        <section className="px-5 lg:order-1 lg:w-[500px] lg:shrink-0 lg:px-8 lg:pb-16">
          <div className="mb-3 mt-5 flex items-center gap-2 border-b border-[var(--border)] pb-2">
            <Search size={17} className="text-[var(--text-3)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש אטרקציה…"
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-3)]" />
          </div>

          <div className="mb-5 flex gap-4 overflow-x-auto pb-1">
            {[null, ...cats].map((c) => {
              const on = activeCat === c;
              return (
                <button key={c ?? "all"} onClick={() => setActiveCat(c)}
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-1 text-[13px] transition"
                  style={{
                    color: on ? "var(--accent-ink)" : "var(--text-2)",
                    fontWeight: on ? 500 : 400,
                    borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                  }}>
                  {c !== null && (
                    <span className="size-2.5 rounded-full" style={{ background: catColor(c) }} />
                  )}
                  {c === null ? "הכל" : CAT_HE[c] ?? c}
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {([
              ["mustSee", "⭐ חובה לביקור"],
              ["free", "חינם"],
              ["indoor", "מקורה"],
              ["top", "מומלץ במיוחד"],
            ] as const).map(([k, label]) => {
              const on = flags[k];
              return (
                <button key={k} onClick={() => toggleFlag(k)}
                  className="rounded-full px-3 py-1.5 text-[12.5px] transition"
                  style={{
                    background: on ? "var(--accent)" : "var(--surface)",
                    color: on ? "#fff" : "var(--text-2)",
                    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                  }}>
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-[14px] text-[var(--text-3)]">אין תוצאות לסינון הזה</p>
            )}
            {filtered.map((a, i) => {
              const isSel = selected?.id === a.id;
              const cost = a.cost_level != null ? COST_HE[a.cost_level] : null;
              return (
                <button key={a.id} onClick={() => setSelected(a)}
                  className="flex items-start gap-3.5 border-b border-[var(--border)] py-3.5 text-right transition"
                  style={{ background: isSel ? "var(--accent-soft)" : "transparent" }}>
                  {a.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bigImage(a.image_url, 256)} alt="" loading="lazy"
                      className="h-[84px] w-[84px] shrink-0 rounded-[8px] object-cover" />
                  ) : (
                    <div className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[8px] bg-[var(--surface-2)]">
                      <span className="serif text-[22px] text-[var(--text-3)]">{(a.name_he || a.name_en).slice(0, 1)}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="eyebrow truncate">{meta(a)}</p>
                      {a.must_see === 1 && (
                        <span className="shrink-0 bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-white">חובה</span>
                      )}
                    </div>
                    <p className="serif mt-0.5 text-[17px] leading-tight">{a.name_he || a.name_en}</p>
                    {a.tagline_he && (
                      <p className="mt-0.5 truncate text-[13px] italic text-[var(--text-2)]">{a.tagline_he}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2.5 text-[12px] text-[var(--text-3)]">
                      {!!a.family_score && (
                        <span className="inline-flex items-center gap-0.5 text-[var(--accent-ink)]">
                          <Star size={11} fill="currentColor" /> {a.family_score}
                        </span>
                      )}
                      {cost && <span>{cost}</span>}
                      {a.best_time_he && <span className="truncate">{a.best_time_he}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
