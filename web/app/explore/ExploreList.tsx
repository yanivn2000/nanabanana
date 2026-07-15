"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, Landmark, Building2, Trees, UtensilsCrossed, ShoppingBag,
  Waves, FerrisWheel, PawPrint, type LucideIcon,
} from "lucide-react";
import { CityPoster } from "@/components/CityPoster";
import type { Destination, DestinationSummary } from "@/lib/db";
import { regionOf, REGION_ORDER } from "@/lib/labels";

// The strongest attraction categories in a city → 1-2 chips of real signal shown
// on the card (beyond name / country / count). Ordered by count, count>0 only.
const CAT_CHIPS: { key: keyof DestinationSummary; label: string; Icon: LucideIcon }[] = [
  { key: "museum", label: "מוזיאונים", Icon: Landmark },
  { key: "historic", label: "היסטוריה", Icon: Building2 },
  { key: "nature", label: "טבע", Icon: Trees },
  { key: "food", label: "אוכל", Icon: UtensilsCrossed },
  { key: "shopping", label: "קניות", Icon: ShoppingBag },
  { key: "water_park", label: "פארקי מים", Icon: Waves },
  { key: "theme_park", label: "פארקי שעשועים", Icon: FerrisWheel },
  { key: "zoo", label: "גן חיות", Icon: PawPrint },
];
function topCats(s: DestinationSummary | undefined, n = 2) {
  if (!s) return [];
  return CAT_CHIPS
    .map((c) => ({ ...c, count: (s[c.key] as number) ?? 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export function ExploreList({ destinations, summaries = [] }: {
  destinations: Destination[];
  summaries?: DestinationSummary[];
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(summaries.map((s) => [s.id, s])), [summaries]);

  const filtered = destinations.filter((d) =>
    `${d.city} ${d.country} ${d.city_he ?? ""} ${d.country_he ?? ""}`
      .toLowerCase()
      .includes(q.toLowerCase())
  );

  // Group by region, in REGION_ORDER, dropping empty regions.
  const byRegion = REGION_ORDER
    .map((region) => ({ region, items: filtered.filter((d) => regionOf(d.country) === region) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <div className="rise-1 mb-5 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 shadow-[var(--shadow)] lg:max-w-md">
        <Search size={18} className="text-[var(--text-3)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חפשו עיר או מדינה…"
          className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]"
        />
      </div>

      {byRegion.length === 0 ? (
        <p className="mt-8 text-center text-sm text-[var(--text-3)]">לא נמצאו יעדים.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {byRegion.map(({ region, items }) => (
            <section key={region}>
              <p className="eyebrow mb-3">{region} · {items.length}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((d) => (
                  <Link
                    key={d.id}
                    href={`/destination/${d.id}`}
                    className="group relative block aspect-[3/2] overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow)]"
                  >
                    <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.04]">
                      <CityPoster destinationId={d.id} cityHe={d.city_he || d.city} overlay
                        orientation="banner" position="50% 45%" className="size-full" />
                    </div>
                    <div className="absolute inset-0 flex flex-col justify-end p-4 text-white">
                      <p className="text-[13px] font-medium text-white/85">{d.country_he || d.country}</p>
                      <h3 className="serif text-[24px] font-bold leading-none">{d.city_he || d.city}</h3>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-[var(--surface)]/92 px-2.5 py-1 text-[12.5px] font-semibold text-[var(--text)] shadow-sm backdrop-blur">
                          {d.attraction_count.toLocaleString("he")} אטרקציות
                        </span>
                        {topCats(byId.get(d.id)).map((c) => (
                          <span key={c.key}
                            className="inline-flex items-center gap-1 rounded-full bg-[var(--surface)]/92 px-2.5 py-1 text-[12.5px] font-medium text-[var(--text-2)] shadow-sm backdrop-blur">
                            <c.Icon size={12} className="text-[var(--brand-ink)]" /> {c.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
