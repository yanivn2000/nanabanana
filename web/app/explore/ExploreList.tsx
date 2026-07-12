"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, ArrowLeft } from "lucide-react";
import { CityPoster } from "@/components/CityPoster";
import type { Destination } from "@/lib/db";
import { regionOf, REGION_ORDER } from "@/lib/labels";

export function ExploreList({ destinations }: { destinations: Destination[] }) {
  const [q, setQ] = useState("");
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
          className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-3)]"
        />
      </div>

      {byRegion.length === 0 ? (
        <p className="mt-8 text-center text-sm text-[var(--text-3)]">לא נמצאו יעדים.</p>
      ) : (
        <div className="flex flex-col gap-7">
          {byRegion.map(({ region, items }) => (
            <section key={region}>
              <p className="eyebrow mb-3">{region} · {items.length}</p>
              <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-3 lg:gap-4">
                {items.map((d) => (
                  <Link
                    key={d.id}
                    href={`/destination/${d.id}`}
                    className="flex items-center gap-3 overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow)]"
                  >
                    <CityPoster destinationId={d.id} cityHe={d.city_he || d.city}
                      className="h-16 w-[58px] shrink-0 rounded-[var(--radius-sm)]" />
                    <div className="min-w-0 flex-1">
                      <p className="serif truncate text-[16px] font-semibold">{d.city_he || d.city}</p>
                      <p className="text-[13px] text-[var(--text-2)]">
                        {d.country_he || d.country} · {d.attraction_count.toLocaleString("he")} אטרקציות
                      </p>
                    </div>
                    <ArrowLeft size={18} className="ms-1 shrink-0 text-[var(--text-3)]" />
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
