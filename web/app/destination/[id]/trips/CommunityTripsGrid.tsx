"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, Eye, Sparkles, CalendarDays, MapPin } from "lucide-react";
import { CityPoster } from "@/components/CityPoster";
import type { SharedTripCard } from "@/lib/db";

const LIKES_KEY = "nanabanana.likes.v1";
function likedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(LIKES_KEY) ?? "[]")); } catch { return new Set(); }
}
function persistLiked(s: Set<string>) {
  try { localStorage.setItem(LIKES_KEY, JSON.stringify([...s])); } catch {}
}

export function CommunityTripsGrid({ destId, cityHe, trips }: {
  destId: number; cityHe: string; trips: SharedTripCard[];
}) {
  const [liked, setLiked] = useState<Set<string>>(likedSet);
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(trips.map((t) => [t.slug, t.likes])));

  async function toggleLike(slug: string) {
    const on = !liked.has(slug);
    const next = new Set(liked);
    if (on) next.add(slug); else next.delete(slug);
    setLiked(next); persistLiked(next);
    setLikeCounts((c) => ({ ...c, [slug]: Math.max(0, (c[slug] ?? 0) + (on ? 1 : -1)) }));
    try {
      const res = await fetch("/api/trips/like", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, on }),
      });
      const data = await res.json();
      if (res.ok && typeof data.likes === "number") {
        setLikeCounts((c) => ({ ...c, [slug]: data.likes }));
      }
    } catch { /* optimistic value stands */ }
  }

  if (trips.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-[15px] font-medium text-[var(--text)]">עדיין אין טיולים משותפים ל{cityHe}</p>
        <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-[var(--text-2)]">
          בנו את הטיול הראשון — וכשתשתפו אותו, הוא יופיע כאן לכל הקהילה.
        </p>
        <Link href={`/destination/${destId}`}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-[14px] font-medium text-white">
          <Sparkles size={15} /> בנו טיול ל{cityHe}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((t) => (
        <div key={t.slug}
          className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg,0_10px_30px_rgba(0,0,0,.1))]">
          <Link href={`/t/${t.slug}`} className="relative block">
            <CityPoster destinationId={destId} cityHe={cityHe} overlay
              orientation="banner" position="50% 45%" className="h-[132px] w-full" />
            <div className="absolute inset-x-0 bottom-0 p-3">
              <h3 className="line-clamp-2 text-[15.5px] font-bold leading-tight text-white">{t.title}</h3>
            </div>
            {/* like — floats on the image, stops the card-link navigation */}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleLike(t.slug); }}
              aria-label="אהבתי"
              className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-[12.5px] font-semibold text-white backdrop-blur-sm transition hover:bg-black/50">
              <Heart size={14} className={liked.has(t.slug) ? "fill-[#ff5a5f] text-[#ff5a5f]" : ""} />
              {likeCounts[t.slug] > 0 ? likeCounts[t.slug] : ""}
            </button>
          </Link>

          <div className="flex flex-1 flex-col p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--text-2)]">
              {t.days != null && <span className="inline-flex items-center gap-1"><CalendarDays size={13} /> {t.days} ימים</span>}
              <span className="inline-flex items-center gap-1"><MapPin size={13} /> {t.stops} עצירות</span>
              <span className="inline-flex items-center gap-1"><Eye size={13} /> {t.views.toLocaleString("he-IL")}</span>
            </div>
            {t.composition && (
              <p className="mt-1.5 line-clamp-1 text-[12.5px] text-[var(--text-3)]">{t.composition}</p>
            )}
            <Link href={`/t/${t.slug}`}
              className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--brand)] bg-[var(--surface)] py-2 text-[13.5px] font-medium text-[var(--brand-ink)] transition group-hover:bg-[var(--brand-soft)]">
              צפו וקחו את הטיול ←
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
