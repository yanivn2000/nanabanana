"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, MapPin, Sparkles, Star } from "lucide-react";
import { MapClient } from "@/components/MapClient";
import { CityPoster } from "@/components/CityPoster";
import { useTrips, MONTHS_HE } from "@/lib/store";
import type { SharedTrip, TripComment, Attraction } from "@/lib/db";

const KIND_ICON: Record<string, string> = {
  nature: "🌳", food: "🍽️", culture: "🏛️", rest: "😌", shopping: "🛍️",
};
const KIND_TO_CAT: Record<string, string> = {
  nature: "nature", food: "food", culture: "museum", rest: "leisure", shopping: "shopping",
};

// The trip's public face: hero → day-by-day plan + map → community comments.
// Remix ("העתיקו וערכו") copies the itinerary into the visitor's own local
// trips — the visitor becomes a user in one click, no login.
export function SharedTripView({ trip, comments: initialComments }: {
  trip: SharedTrip; comments: TripComment[];
}) {
  const router = useRouter();
  const { create } = useTrips();
  const [dayIdx, setDayIdx] = useState(0);
  const [comments, setComments] = useState(initialComments);
  const days = trip.itinerary.days;
  const day = days[Math.min(dayIdx, days.length - 1)];
  const totalStops = days.reduce((n, d) => n + d.stops.length, 0);

  // Am I the owner? (the publish flow stores the token client-side)
  const ownerToken = typeof window !== "undefined"
    ? (() => { try { return JSON.parse(localStorage.getItem("nanabanana.shares.v1") ?? "{}")[trip.slug] ?? null; } catch { return null; } })()
    : null;

  const mapStops = (day?.stops ?? []).filter((s) => s.lat != null && s.lng != null);
  const stopPoints = useMemo(() => mapStops.map((s, i) => ({
    id: i, name_he: s.name, name_en: s.name, lat: s.lat!, lng: s.lng!,
    category: KIND_TO_CAT[s.kind] ?? "attraction", subcategory: null,
    indoor_outdoor: null, family_score: s.score ?? null, tips_he: null,
    website: s.website ?? null, duration_minutes: null, image_url: s.image ?? null,
    tagline_he: s.tagline ?? null, best_season: null, best_time_he: s.bestTime ?? null,
    dress_he: null, cost_level: s.cost ?? null, must_see: null,
  })) as Attraction[], [mapStops]);
  const center: [number, number] = mapStops.length
    ? [mapStops[0].lat as number, mapStops[0].lng as number] : [48, 15];

  function remix() {
    const t = create({
      title: trip.title,
      mode: "preferences",
      city: trip.city ?? undefined,
      cityHe: trip.city_he ?? undefined,
      country: trip.country ?? undefined,
      destinationId: trip.destination_id ?? undefined,
      days: trip.days ?? days.length,
      month: trip.month ?? new Date().getMonth() + 1,
      itinerary: trip.itinerary,
      remixOf: trip.slug,
    });
    router.push(`/trip/${t.id}`);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 lg:px-8">
      {/* hero */}
      <div className="relative mt-4 overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow)]">
        <CityPoster destinationId={trip.destination_id} cityHe={trip.city_he} overlay
          orientation="banner" position="50% 45%" className="h-[240px] w-full sm:h-[280px]" />
        <div className="absolute inset-0 flex flex-col justify-end p-5 text-white sm:p-6">
          <h1 className="serif text-[28px] font-black leading-tight sm:text-[34px]">{trip.title}</h1>
          <p className="mt-1.5 text-[14.5px] text-white/90">
            {days.length} ימים · {totalStops} עצירות
            {trip.month ? ` · ${MONTHS_HE[trip.month - 1]}` : ""}
            {trip.composition ? ` · ${trip.composition}` : ""}
          </p>
          <p className="mt-0.5 text-[12.5px] text-white/70">
            טיול של מטייל/ת בקהילת Yalle · נצפה {(trip.views + 1).toLocaleString("he-IL")} פעמים
          </p>
        </div>
      </div>

      {/* CTA row — the retention hooks */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={remix}
          className="flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-[14.5px] font-semibold text-white shadow-[0_6px_16px_rgba(14,107,94,.3)]">
          <Copy size={15} /> העתיקו וערכו אצלכם — חינם
        </button>
        {trip.destination_id && (
          <Link href={`/destination/${trip.destination_id}`}
            className="flex items-center gap-2 rounded-full border border-[var(--brand)] bg-[var(--surface)] px-5 py-2.5 text-[14.5px] font-medium text-[var(--brand-ink)]">
            <Sparkles size={15} /> בנו טיול משלכם ל{trip.city_he || trip.city}
          </Link>
        )}
      </div>

      <div className="mt-5 lg:flex lg:items-start lg:gap-5">
        {/* plan */}
        <section className="min-w-0 flex-1">
          {/* day tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
            {days.map((d, i) => (
              <button key={i} onClick={() => setDayIdx(i)}
                className="shrink-0 rounded-full px-4 py-1.5 text-[13.5px] font-medium transition"
                style={{ background: i === dayIdx ? "var(--brand)" : "var(--surface)",
                         color: i === dayIdx ? "#fff" : "var(--text-2)",
                         border: `1px solid ${i === dayIdx ? "var(--brand)" : "var(--border)"}` }}>
                {d.label || `יום ${i + 1}`}
              </button>
            ))}
          </div>

          {day?.why && (
            <p className="mb-3 rounded-[var(--radius-sm)] bg-[var(--brand-soft)] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--brand-ink)]">
              {day.why}
            </p>
          )}

          <div className="flex flex-col gap-2.5">
            {(day?.stops ?? []).map((s, i) => (
              <div key={i} className="flex gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3">
                {s.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image} alt="" loading="lazy"
                    className="size-[72px] shrink-0 rounded-[10px] object-cover" />
                ) : (
                  <div className="grid size-[72px] shrink-0 place-items-center rounded-[10px] bg-[var(--surface-2)] text-[24px]">
                    {KIND_ICON[s.kind] ?? "📍"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold text-[var(--brand-ink)]" dir="ltr">{s.time}</span>
                    <span className="text-[15.5px] font-bold">{s.name}</span>
                    {s.anchor === true && (
                      <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10.5px] font-medium text-white">עוגן</span>
                    )}
                    {s.anchor === false && (
                      <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10.5px] text-[var(--text-3)]">אם יש זמן</span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-[var(--text-3)]">{s.duration}</p>
                  {(s.tagline || s.note) && (
                    <p className="mt-1 text-[13px] leading-snug text-[var(--text-2)]">{s.tagline || s.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* map rail */}
        <div className="sticky top-4 mt-4 h-[300px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] shadow-[var(--shadow)] lg:mt-0 lg:h-[480px] lg:w-[360px] lg:shrink-0">
          {stopPoints.length ? (
            <MapClient attractions={stopPoints} center={center} selected={null} ordered />
          ) : (
            <div className="grid h-full place-items-center text-[13.5px] text-[var(--text-3)]">
              <span className="flex items-center gap-1.5"><MapPin size={15} /> אין נקודות ממופות ליום זה</span>
            </div>
          )}
        </div>
      </div>

      {/* community comments — the Facebook-thread experience, on our turf */}
      <CommentsSection slug={trip.slug} days={days.length} comments={comments}
        setComments={setComments} ownerToken={ownerToken} />
    </main>
  );
}

function CommentsSection({ slug, days, comments, setComments, ownerToken }: {
  slug: string; days: number; comments: TripComment[];
  setComments: (c: TripComment[]) => void; ownerToken: string | null;
}) {
  const [name, setName] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("nanabanana.commenter") ?? "" : "");
  const [body, setBody] = useState("");
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");

  async function submit() {
    if (name.trim().length < 2 || body.trim().length < 3 || state === "sending") return;
    setState("sending");
    try {
      localStorage.setItem("nanabanana.commenter", name.trim());
      const res = await fetch("/api/trips/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, day_index: dayIndex, author_name: name.trim(), body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments([...comments, data.comment]);
      setBody(""); setState("idle");
    } catch { setState("error"); }
  }

  async function markHelpful(id: number, on: boolean) {
    if (!ownerToken) return;
    await fetch("/api/trips/comments", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, owner_token: ownerToken, comment_id: id, helpful: on }),
    });
    setComments(comments.map((c) => c.id === id ? { ...c, helpful: on } : c));
  }

  return (
    <section className="mt-8">
      <h2 className="serif mb-1 text-[21px] font-bold">💬 תגובות מטיילים</h2>
      <p className="mb-4 text-[13.5px] text-[var(--text-2)]">
        טיפים, תיקונים והמלצות — בדיוק כמו בקבוצה, רק שכאן זה נשמר ליד הטיול.
      </p>

      <div className="flex flex-col gap-2">
        {comments.length === 0 && (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] p-4 text-center text-[13.5px] text-[var(--text-3)]">
            עדיין אין תגובות — היו הראשונים לתת טיפ 🙌
          </p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="rounded-[var(--radius-sm)] border bg-[var(--surface)] p-3"
            style={{ borderColor: c.helpful ? "var(--brand)" : "var(--border)" }}>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--text-3)]">
              <span className="font-semibold text-[var(--text)]">{c.author_name}</span>
              {c.day_index != null && (
                <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 font-medium text-[var(--brand-ink)]">
                  יום {c.day_index + 1}
                </span>
              )}
              <span dir="ltr">{new Date(c.created_at).toLocaleDateString("he-IL")}</span>
              {c.helpful && (
                <span className="flex items-center gap-1 text-[var(--brand-ink)]"><Star size={12} /> עזר למתכנן</span>
              )}
              {ownerToken && (
                <button onClick={() => markHelpful(c.id, !c.helpful)}
                  className="mr-auto rounded-full border border-[var(--border)] px-2 py-0.5 text-[11.5px] text-[var(--text-2)]">
                  {c.helpful ? "בטלו סימון" : "✔ עזר לי"}
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{c.body}</p>
          </div>
        ))}
      </div>

      {/* new comment */}
      <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="mb-2 flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="השם שלכם"
            className="w-44 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[14px] outline-none focus:border-[var(--brand)]" />
          <select value={dayIndex ?? -1} onChange={(e) => setDayIndex(Number(e.target.value) < 0 ? null : Number(e.target.value))}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-[13.5px]">
            <option value={-1}>על כל הטיול</option>
            {Array.from({ length: days }, (_, i) => (
              <option key={i} value={i}>יום {i + 1}</option>
            ))}
          </select>
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
          placeholder="טיפ / תיקון / המלצה… (למשל: ׳יותר מדי זמן בבראשוב — תעברו יום לסיביו׳)"
          className="mb-2 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[14px] outline-none focus:border-[var(--brand)]" />
        {state === "error" && <p className="mb-2 text-[13px] text-[#c0453f]">משהו השתבש — נסו שוב.</p>}
        <button onClick={submit} disabled={name.trim().length < 2 || body.trim().length < 3 || state === "sending"}
          className="flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2 text-[14px] font-medium text-white disabled:opacity-50">
          {state === "sending" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          פרסמו תגובה
        </button>
      </div>
    </section>
  );
}
