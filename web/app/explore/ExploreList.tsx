"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, MapPin, ArrowLeft } from "lucide-react";
import type { Destination } from "@/lib/db";

export function ExploreList({ destinations }: { destinations: Destination[] }) {
  const [q, setQ] = useState("");
  const filtered = destinations.filter(
    (d) =>
      d.city.toLowerCase().includes(q.toLowerCase()) ||
      d.country.toLowerCase().includes(q.toLowerCase())
  );

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

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-sm text-[var(--text-3)]">לא נמצאו יעדים.</p>
      ) : (
        <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-3 lg:gap-4">
          {filtered.map((d) => (
            <Link
              key={d.id}
              href={`/destination/${d.id}`}
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
    </>
  );
}
