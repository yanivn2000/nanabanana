"use client";

import Link from "next/link";
import { SAMPLE_TRIP } from "@/lib/sample";
import { useProfile, profileSummary } from "@/lib/store";
import { Plus, ArrowLeft } from "lucide-react";

export default function TripsPage() {
  const [p, , loaded] = useProfile();

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-8 lg:max-w-3xl lg:px-8 lg:pb-12">
      <header className="rise mb-5">
        <h1 className="text-[26px] font-bold leading-tight">הטיולים שלי</h1>
        {loaded && (
          <p className="mt-1 text-sm text-[var(--text-2)]">{profileSummary(p)}</p>
        )}
      </header>

      <Link
        href={`/trip/${SAMPLE_TRIP.id}`}
        className="rise rise-1 mb-3 block rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[17px] font-bold">{SAMPLE_TRIP.title} {SAMPLE_TRIP.cover}</p>
            <p className="mt-0.5 text-[13px] text-[var(--text-2)]">{SAMPLE_TRIP.subtitle} · {SAMPLE_TRIP.days} ימים</p>
          </div>
          <ArrowLeft size={18} className="text-[var(--text-3)]" />
        </div>
      </Link>

      <Link
        href="/explore"
        className="rise rise-2 flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] py-5 text-[15px] font-medium text-[var(--text-2)]"
      >
        <Plus size={18} /> טיול חדש
      </Link>
    </main>
  );
}
