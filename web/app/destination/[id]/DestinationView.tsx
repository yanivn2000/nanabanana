"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight, Star, Mountain, Landmark, Trees, Dumbbell,
  UtensilsCrossed, ShoppingBag, MapPin, ExternalLink, Search,
} from "lucide-react";
import { MapClient } from "@/components/MapClient";
import { descriptor } from "@/lib/labels";
import type { Attraction, Destination } from "@/lib/db";

const CAT: Record<string, { he: string; Icon: typeof Mountain; color: string; soft: string }> = {
  nature: { he: "טבע", Icon: Trees, color: "var(--brand-ink)", soft: "var(--brand-soft)" },
  museum: { he: "מוזיאון", Icon: Landmark, color: "var(--blue)", soft: "var(--blue-soft)" },
  attraction: { he: "אטרקציה", Icon: Mountain, color: "var(--amber)", soft: "var(--amber-soft)" },
  sport: { he: "ספורט", Icon: Dumbbell, color: "var(--amber)", soft: "var(--amber-soft)" },
  food: { he: "אוכל", Icon: UtensilsCrossed, color: "var(--blue)", soft: "var(--blue-soft)" },
  shopping: { he: "קניות", Icon: ShoppingBag, color: "var(--blue)", soft: "var(--blue-soft)" },
};
function cat(c: string) {
  return CAT[c] ?? { he: c, Icon: MapPin, color: "var(--text-2)", soft: "var(--surface-2)" };
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

  const cats = useMemo(
    () => Array.from(new Set(attractions.map((a) => a.category))),
    [attractions]
  );
  const filtered = useMemo(
    () =>
      attractions.filter((a) => {
        if (activeCat && a.category !== activeCat) return false;
        if (query) {
          const hay = `${a.name_he ?? ""} ${a.name_en} ${descriptor(a)}`.toLowerCase();
          if (!hay.includes(query.toLowerCase())) return false;
        }
        return true;
      }),
    [attractions, activeCat, query]
  );

  return (
    <main className="mx-auto max-w-[440px] pb-28">
      <header className="rise bg-[var(--brand)] px-5 pb-6 pt-7 text-white">
        <Link href="/" className="mb-4 flex items-center gap-1 text-[13px] text-[var(--brand-soft)]">
          <ChevronRight size={16} /> בית
        </Link>
        <h1 className="text-[27px] font-bold leading-tight">{dest.city}</h1>
        <p className="mt-1 text-sm text-[var(--brand-soft)]">
          {dest.country} · {dest.attraction_count.toLocaleString("he")} אטרקציות במאגר
        </p>
      </header>

      <div className="sticky top-0 z-10 h-[260px] w-full overflow-hidden border-b border-[var(--border)]">
        <MapClient attractions={filtered} center={[dest.lat, dest.lng]} selected={selected} />
      </div>

      <section className="px-5">
        <div className="mb-3 mt-5 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 shadow-[var(--shadow)]">
          <Search size={18} className="text-[var(--text-3)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חפשו אטרקציה…"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-3)]"
          />
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCat(null)}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition"
            style={{
              background: activeCat === null ? "var(--brand)" : "var(--surface)",
              color: activeCat === null ? "#fff" : "var(--text-2)",
              border: `1px solid ${activeCat === null ? "var(--brand)" : "var(--border)"}`,
            }}
          >
            הכל
          </button>
          {cats.map((c) => {
            const m = cat(c);
            const on = activeCat === c;
            return (
              <button
                key={c}
                onClick={() => setActiveCat(on ? null : c)}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition"
                style={{
                  background: on ? "var(--brand)" : "var(--surface)",
                  color: on ? "#fff" : "var(--text-2)",
                  border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                }}
              >
                {m.he}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2.5">
          {filtered.map((a) => {
            const m = cat(a.category);
            const isSel = selected?.id === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className={`flex w-full items-stretch gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-2.5 text-right shadow-[var(--shadow)] transition ${
                  isSel ? "ring-2 ring-[var(--brand)]" : ""
                }`}
              >
                {a.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.image_url}
                    alt=""
                    loading="lazy"
                    className="size-[60px] shrink-0 rounded-[12px] object-cover"
                  />
                ) : (
                  <div className="grid size-[60px] shrink-0 place-items-center rounded-[12px]"
                       style={{ background: m.soft, color: m.color }}>
                    <m.Icon size={22} />
                  </div>
                )}

                <div className="min-w-0 flex-1 py-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] font-medium leading-tight">
                      {a.name_he || a.name_en}
                    </p>
                    {!!a.family_score && (
                      <span className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-[var(--brand-ink)]">
                        <Star size={13} fill="currentColor" /> {a.family_score}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-2)]">
                    {descriptor(a)}
                  </p>
                  {a.website && (
                    <a
                      href={a.website}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-[var(--blue)]"
                    >
                      <ExternalLink size={12} /> אתר
                    </a>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
