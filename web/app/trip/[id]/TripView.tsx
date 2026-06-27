"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronRight, Mountain, Utensils, Landmark, Coffee, ShoppingBag,
  Sparkles, Star, Loader2,
} from "lucide-react";
import { KIND_META } from "@/lib/sample";
import type { Itinerary, Stop } from "@/lib/trip-types";
import { useTrips, useProfile, useHotels, profileText } from "@/lib/store";
import { Hotels } from "@/app/trips/Hotels";
import { AskBar } from "./AskBar";

const ICONS = {
  mountain: Mountain, utensils: Utensils, landmark: Landmark,
  coffee: Coffee, "shopping-bag": ShoppingBag,
} as const;

function StopIcon({ kind }: { kind: Stop["kind"] }) {
  const meta = KIND_META[kind];
  const Icon = ICONS[meta.icon as keyof typeof ICONS] ?? Coffee;
  return (
    <div className="grid size-10 shrink-0 place-items-center rounded-[12px]"
         style={{ background: meta.soft, color: meta.color }}>
      <Icon size={19} />
    </div>
  );
}

export function TripView({ tripId }: { tripId: string }) {
  const { trips, update, loaded } = useTrips();
  const [profile] = useProfile();
  const { hotels } = useHotels();
  const [busy, setBusy] = useState<null | "generate" | "revise">(null);
  const [error, setError] = useState<string | null>(null);

  const trip = trips.find((t) => t.id === tripId);
  const itinerary = trip?.itinerary ?? null;
  const tripHotels = hotels.filter((h) => h.tripId === tripId);
  // City for attractions: the trip's destination, or derived from a linked hotel.
  const city = trip?.city || tripHotels[0]?.city;

  async function call(payload: object, mode: "generate" | "revise") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city, profileText: profileText(profile), ...payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const msg =
          data?.code === "no_key" ? "ה-AI עוד לא מוגדר בשרת (חסר מפתח)."
          : data?.code === "no_credit" ? "נגמר הקרדיט ב-Claude — לא ניתן לשנות בשיחה כרגע."
          : data?.error || "אירעה שגיאה";
        setError(msg);
        return;
      }
      update(tripId, { itinerary: data.itinerary });
    } catch {
      setError("שגיאת רשת");
    } finally {
      setBusy(null);
    }
  }

  const generate = () => call({
    mode: "generate",
    days: trip?.days ?? 4,
    hotels: tripHotels.map((h) => ({ name: h.name, city: h.city, lat: h.lat, lng: h.lng })),
  }, "generate");
  const revise = (instruction: string) =>
    call({ mode: "revise", current: itinerary, instruction }, "revise");

  if (loaded && !trip) {
    return (
      <main className="mx-auto max-w-[440px] px-5 pt-16 text-center">
        <p className="serif text-[22px]">הטיול לא נמצא</p>
        <Link href="/trips" className="mt-3 inline-block text-[14px] text-[var(--accent-ink)]">← לכל הטיולים</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[440px] pb-32 lg:max-w-2xl">
      <header className="rise bg-[var(--surface)] px-5 pb-6 pt-8 lg:px-8">
        <Link href="/trips" className="eyebrow mb-3 inline-flex items-center gap-1">
          <ChevronRight size={14} /> הטיולים שלי
        </Link>
        <h1 className="serif text-[32px] leading-none lg:text-[40px]">{trip?.title ?? "…"}</h1>
        <div className="rule mt-3"></div>
        <p className="mt-3 text-[13px] text-[var(--text-2)]">
          {city ? `${city} · ` : ""}{trip?.days} ימים
          {trip?.mode === "hotels" ? " · טיול כוכב" : ""}
        </p>
        <button onClick={generate} disabled={!!busy || (!city)}
          className="mt-4 flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-white disabled:opacity-50">
          {busy === "generate" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {busy === "generate" ? "בונה לו\"ז…" : itinerary ? "בנה מחדש" : "בנה לו\"ז עם AI"}
        </button>
        {!city && trip?.mode === "hotels" && (
          <p className="mt-2 text-[12px] text-[var(--text-3)]">הוסיפו מלון כדי לקבוע את אזור הטיול</p>
        )}
      </header>

      {/* hotels (always available; central for star-trips) */}
      <div className="px-5 pt-5 lg:px-8">
        <Hotels tripId={tripId} />
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-[var(--radius-card)] bg-[var(--amber-soft)] px-4 py-3 text-[13px] text-[var(--amber)] lg:mx-8">
          {error}
        </div>
      )}

      {itinerary && (
        <div className={`px-5 transition-opacity lg:px-8 ${busy ? "opacity-50" : ""}`}>
          {itinerary.days.map((day, di) => (
            <section key={di} className="mt-7">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[15px] font-bold">{day.label}</span>
                <span className="text-[13px] text-[var(--text-3)]">· {day.date} · {day.base}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {day.stops.map((s, si) => (
                  <div key={si} className="flex items-start gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]">
                    <StopIcon kind={s.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[15px] font-medium leading-tight">{s.name}</p>
                        {!!s.score && (
                          <span className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-[var(--accent-ink)]">
                            <Star size={13} fill="currentColor" /> {s.score}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] text-[var(--text-3)]">{s.time} · {s.duration}</p>
                      {s.note && <p className="mt-1.5 text-[13px] leading-snug text-[var(--text-2)]">{s.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {day.why && (
                <div className="mt-3 flex gap-2.5 rounded-[var(--radius-card)] bg-[var(--accent-soft)] p-3.5">
                  <Sparkles size={17} className="mt-0.5 shrink-0 text-[var(--accent-ink)]" />
                  <p className="text-[13px] leading-snug text-[var(--accent-ink)]">
                    <span className="font-bold">למה ככה: </span>{day.why}
                  </p>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {itinerary && <AskBar onSend={revise} busy={busy === "revise"} />}
    </main>
  );
}
