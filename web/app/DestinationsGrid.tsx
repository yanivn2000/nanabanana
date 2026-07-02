"use client";

import { useState } from "react";
import Link from "next/link";
import { MapPin, ArrowLeft } from "lucide-react";
import type { Destination } from "@/lib/db";

// Destinations list with a sort toggle (popularity ← default, or A-Z by the
// Hebrew display name). Client-side so the toggle is instant. (#23)
export function DestinationsGrid({ destinations }: { destinations: Destination[] }) {
  const [sort, setSort] = useState<"popular" | "az">("popular");
  const name = (d: Destination) => d.city_he || d.city;
  const list =
    sort === "az"
      ? [...destinations].sort((a, b) => name(a).localeCompare(name(b), "he"))
      : destinations; // listDestinations already returns popularity order

  if (destinations.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] bg-[var(--surface)] p-5 text-center text-sm text-[var(--text-2)]">
        עדיין אין נתונים — הריצו איסוף בכלי הניהול.
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex w-fit gap-1 rounded-full bg-[var(--surface-2)] p-1">
        {([["popular", "פופולרי"], ["az", "א-ב"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setSort(k)}
            className="rounded-full px-3.5 py-1 text-[12.5px] transition"
            style={{
              background: sort === k ? "var(--surface)" : "transparent",
              color: sort === k ? "var(--text)" : "var(--text-2)",
              fontWeight: sort === k ? 500 : 400,
              boxShadow: sort === k ? "var(--shadow)" : "none",
            }}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-3 lg:gap-4">
        {list.map((d) => (
          <Link href={`/destination/${d.id}`} key={d.id}
            className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]">
            <div className="grid size-11 place-items-center rounded-[var(--radius-sm)] bg-[var(--brand-soft)] text-[var(--brand-ink)]">
              <MapPin size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{d.city_he || d.city}</p>
              <p className="text-[13px] text-[var(--text-2)]">
                {d.country_he || d.country} · {d.attraction_count.toLocaleString("he")} אטרקציות
              </p>
            </div>
            <ArrowLeft size={18} className="text-[var(--text-3)]" />
          </Link>
        ))}
      </div>
    </>
  );
}
