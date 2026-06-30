"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ChevronRight, Mountain, Utensils, Landmark, Coffee, ShoppingBag,
  Sparkles, Star, Loader2, Pencil, ChevronUp, ChevronDown,
  ChevronsUp, ChevronsDown, Trash2, ExternalLink, Navigation, Map as MapIcon, Users,
} from "lucide-react";
import { googleMapsUrl } from "@/lib/geo";
import { bigImage, segColor } from "@/lib/labels";
import { KIND_META } from "@/lib/sample";
import type { Itinerary, Stop } from "@/lib/trip-types";
import type { Attraction } from "@/lib/db";
import { useTrips, useProfile, useHotels, profileText, profileSummary, MONTHS_HE } from "@/lib/store";
import { ProfileEditor } from "@/components/ProfileEditor";
import { Hotels } from "@/app/trips/Hotels";
import { MapClient } from "@/components/MapClient";
import { AskBar } from "./AskBar";

const KIND_TO_CAT: Record<string, string> = {
  nature: "nature", food: "food", culture: "museum", shopping: "shopping", rest: "leisure",
};

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
  const [globalProfile] = useProfile();
  const { hotels } = useHotels();
  const [busy, setBusy] = useState<null | "generate" | "revise">(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTravelers, setEditTravelers] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [activeSegment, setActiveSegment] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; n: number } | null>(null);
  const COST_HE = ["חינם", "₪", "₪₪", "₪₪₪"];

  const trip = trips.find((t) => t.id === tripId);
  const itinerary = trip?.itinerary ?? null;
  // Per-trip travelers override the global profile (different group per trip).
  const tripProfile = trip?.profile ?? globalProfile;
  const tripHotels = hotels.filter((h) => h.tripId === tripId);
  // City for attractions/API: English destination, or derived from a linked hotel.
  const city = trip?.city || tripHotels[0]?.city;
  // City for display: Hebrew (hotel city from geocode is already Hebrew).
  const cityHe = trip?.cityHe || tripHotels[0]?.city || trip?.city;

  // Segments (legs) of a multi-city trip — used to colour/filter the map.
  const segs = trip?.segments ?? [];
  const multiTrip = segs.length > 1;
  const segIndexOf = (base?: string): number => {
    if (!base || !multiTrip) return 0;
    const i = segs.findIndex((s) =>
      s.city === base || s.cityHe === base ||
      (s.city && base.includes(s.city)) || (s.cityHe && base.includes(s.cityHe)));
    return i >= 0 ? i : 0;
  };

  // Map points = the selected day's stops, the selected segment's, or all.
  const allDays = itinerary?.days ?? [];
  const mapDays =
    activeDay != null && allDays[activeDay] ? [allDays[activeDay]]
    : multiTrip && activeSegment != null ? allDays.filter((d) => segIndexOf(d.base) === activeSegment)
    : allDays;
  const mapStops = mapDays.flatMap((d) =>
    d.stops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ s, seg: segIndexOf(d.base) })));
  const stopPoints = mapStops.map(({ s }, i) => ({
    id: i, name_he: s.name, name_en: s.name, lat: s.lat!, lng: s.lng!,
    category: KIND_TO_CAT[s.kind] ?? "attraction", subcategory: null,
    indoor_outdoor: null, family_score: s.score ?? null, tips_he: null,
    website: s.website ?? null, duration_minutes: null, image_url: s.image ?? null,
    tagline_he: s.tagline ?? null, best_season: null, best_time_he: s.bestTime ?? null,
    dress_he: null, cost_level: s.cost ?? null, must_see: null,
  })) as Attraction[];
  const stopSegIdx = mapStops.map(({ seg }) => seg);
  // Hotels with coordinates — always shown on the map with a distinct marker.
  const hotelPoints = tripHotels
    .filter((h) => h.lat != null && h.lng != null)
    .map((h) => ({ id: h.id, name: h.name, lat: h.lat as number, lng: h.lng as number }));

  const centerFrom = stopPoints.length ? stopPoints : hotelPoints;
  const mapCenter: [number, number] = centerFrom.length
    ? [
        centerFrom.reduce((a, p) => a + (p.lat as number), 0) / centerFrom.length,
        centerFrom.reduce((a, p) => a + (p.lng as number), 0) / centerFrom.length,
      ]
    : [0, 0];

  // Trip calendar dates (from the earliest hotel check-in). Enables live mode:
  // only when today falls inside the trip do "today"/"tomorrow" mean anything.
  const dayLabels = itinerary?.days.map((d, i) => d.label || `יום ${i + 1}`) ?? [];
  const dayCount = dayLabels.length;
  const startISO = tripHotels.map((h) => h.checkIn).filter(Boolean).sort()[0];
  const startDate = startISO ? new Date(startISO + "T00:00:00") : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayDate = (i: number) => (startDate ? new Date(startDate.getTime() + i * 86400000) : null);
  const endDate = startDate && dayCount ? dayDate(dayCount - 1) : null;
  const isLive = !!(startDate && endDate && today >= startDate && today <= endDate);
  const todayIndex = isLive ? Math.round((today.getTime() - startDate!.getTime()) / 86400000) : null;
  const tomorrowIndex = todayIndex != null && todayIndex + 1 < dayCount ? todayIndex + 1 : null;

  const fmtDate = (d: Date) => d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" });
  let dateContext = "";
  if (startDate && dayCount) {
    dateContext = `תאריך היום: ${fmtDate(today)}.\n` +
      dayLabels.map((l, i) => `${l} = ${fmtDate(dayDate(i)!)}`).join("\n");
    dateContext += isLive
      ? `\nאנחנו עכשיו ביום ${todayIndex! + 1} של הטיול. "היום"=יום ${todayIndex! + 1}` +
        (tomorrowIndex != null ? `, "מחר"=יום ${tomorrowIndex + 1}` : "") + "."
      : `\nהמשתמש לא נמצא כרגע בטיול — אין "היום"/"מחר"; פנה לימים לפי המספר שלהם.`;
  }

  async function call(payload: object, mode: "generate" | "revise") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city, profileText: profileText(tripProfile), ...payload }),
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
    month: trip?.month,
    hotels: tripHotels.map((h) => ({ name: h.name, city: h.city, lat: h.lat, lng: h.lng })),
    ...(trip?.segments && trip.segments.length > 1
      ? { segments: trip.segments.map((s) => ({
          city: s.city, days: s.days,
          hotels: tripHotels
            .filter((h) => h.segmentId === s.id)
            .map((h) => ({ name: h.name, city: h.city, lat: h.lat, lng: h.lng })),
        })) }
      : {}),
  }, "generate");
  const revise = (instruction: string) =>
    call({ mode: "revise", current: itinerary, instruction, dateContext: dateContext || undefined }, "revise");

  // Auto-attach details to trips created before details existed (no AI/credit).
  useEffect(() => {
    if (!itinerary || !city) return;
    const stops = itinerary.days.flatMap((d) => d.stops);
    if (stops.length === 0) return;
    if (stops.some((s) => s.lat != null || s.image || s.website)) return; // already has details
    let cancelled = false;
    fetch("/api/itinerary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "details", city, current: itinerary,
        hotels: tripHotels.map((h) => ({ name: h.name, city: h.city, lat: h.lat, lng: h.lng })) }),
    })
      .then((r) => r.json()).catch(() => null)
      .then((d) => { if (!cancelled && d?.itinerary) update(tripId, { itinerary: d.itinerary }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, !!itinerary, city]);

  // --- manual editing: apply a transform to a clone, relabel days, save ---
  function mutate(fn: (it: Itinerary) => void) {
    if (!itinerary) return;
    const it: Itinerary = JSON.parse(JSON.stringify(itinerary));
    fn(it);
    it.days = it.days.filter((d) => d.stops.length > 0);
    it.days.forEach((d, i) => { d.label = `יום ${i + 1}`; });
    update(tripId, { itinerary: it });
  }
  const swap = <T,>(arr: T[], i: number, j: number) => {
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  };
  const moveDay = (di: number, dir: -1 | 1) => mutate((it) => swap(it.days, di, di + dir));
  const moveStop = (di: number, si: number, dir: -1 | 1) =>
    mutate((it) => swap(it.days[di].stops, si, si + dir));
  const moveStopToDay = (di: number, si: number, dir: -1 | 1) =>
    mutate((it) => {
      const tgt = di + dir;
      if (tgt < 0 || tgt >= it.days.length) return;
      const [s] = it.days[di].stops.splice(si, 1);
      it.days[tgt].stops.push(s);
    });
  const deleteStop = (di: number, si: number) =>
    mutate((it) => { it.days[di].stops.splice(si, 1); });

  if (loaded && !trip) {
    return (
      <main className="mx-auto max-w-[440px] px-5 pt-16 text-center">
        <p className="serif text-[22px]">הטיול לא נמצא</p>
        <Link href="/trips" className="mt-3 inline-block text-[14px] text-[var(--accent-ink)]">← לכל הטיולים</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[440px] pb-32 lg:max-w-6xl">
      <header className="rise bg-[var(--surface)] px-5 pb-6 pt-8 lg:px-8">
        <Link href="/trips" className="eyebrow mb-3 inline-flex items-center gap-1">
          <ChevronRight size={14} /> הטיולים שלי
        </Link>
        <h1 className="serif text-[32px] leading-none lg:text-[40px]">{trip?.title ?? "…"}</h1>
        <div className="rule mt-3"></div>
        <p className="mt-3 text-[13px] text-[var(--text-2)]">
          {trip?.segments && trip.segments.length > 1
            ? `${trip.segments.map((s) => s.cityHe || s.city).join(" → ")} · `
            : cityHe ? `${cityHe} · ` : ""}
          {trip?.days} ימים
          {trip?.month ? ` · ${MONTHS_HE[trip.month - 1]}` : ""}
          {trip?.segments && trip.segments.length > 1 ? ` · ${trip.segments.length} ערים` : ""}
          {trip?.mode === "hotels" ? " · טיול כוכב" : ""}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={generate} disabled={!!busy || (!city)}
            className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-white disabled:opacity-50">
            {busy === "generate" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy === "generate" ? "בונה לו\"ז…" : itinerary ? "בנה מחדש" : "בנה לו\"ז עם AI"}
          </button>
          {itinerary && (
            <button onClick={() => setEditing((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-4 py-2.5 text-[14px] font-medium"
              style={{ background: editing ? "var(--accent-soft)" : "transparent",
                       color: editing ? "var(--accent-ink)" : "var(--text-2)" }}>
              <Pencil size={14} /> {editing ? "סיום עריכה" : "עריכה ידנית"}
            </button>
          )}
          <button onClick={() => setEditTravelers((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-4 py-2.5 text-[14px] font-medium"
            style={{ background: editTravelers ? "var(--brand-soft)" : "transparent",
                     color: editTravelers ? "var(--brand-ink)" : "var(--text-2)" }}>
            <Users size={14} /> מי נוסע
          </button>
        </div>

        <p className="mt-2 text-[12px] text-[var(--text-3)]">
          נוסעים: {profileSummary(tripProfile)}{trip?.profile ? "" : " · ברירת מחדל מהפרופיל הכללי"}
        </p>

        {editTravelers && (
          <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-4 lg:max-w-2xl">
            <p className="mb-3 text-[13px] text-[var(--text-2)]">
              מי נוסע בטיול <span className="font-medium">הזה</span>? משפיע על מה שה-AI יבנה (טיול עם הילדים שונה מטיול זוגי) — לא משנה את הפרופיל הכללי.
            </p>
            <ProfileEditor value={tripProfile} onChange={(p) => update(tripId, { profile: p })} />
            {trip?.profile && (
              <button onClick={() => update(tripId, { profile: undefined })}
                className="mt-4 text-[12px] text-[var(--accent-ink)] underline">אפס לפרופיל הכללי</button>
            )}
          </div>
        )}

        {!city && trip?.mode === "hotels" && (
          <p className="mt-2 text-[12px] text-[var(--text-3)]">הוסיפו מלון כדי לקבוע את אזור הטיול</p>
        )}
      </header>

      <div className="lg:flex lg:items-start lg:gap-8 lg:px-8 lg:pt-6">
        {/* aside: hotels + map of the trip (map on desktop only) */}
        <aside className="lg:order-2 lg:w-[360px] lg:shrink-0 lg:sticky lg:top-[73px]">
          <div className="px-5 pt-5 lg:px-0 lg:pt-0">
            <Hotels tripId={tripId} segments={trip?.segments}
              onFocus={(h) => h.lat != null && h.lng != null && setFocus({ lat: h.lat, lng: h.lng, n: Date.now() })} />
          </div>
          {(stopPoints.length > 0 || hotelPoints.length > 0) && (
            <div className="mt-5 hidden lg:block">
              {/* segment filter (multi-city): show a whole leg on the map */}
              {multiTrip && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <button onClick={() => { setActiveSegment(null); setActiveDay(null); }}
                    className="rounded-full px-2.5 py-1 text-[12px] transition"
                    style={{
                      background: activeSegment == null ? "var(--accent)" : "var(--surface)",
                      color: activeSegment == null ? "#fff" : "var(--text-2)",
                      border: `1px solid ${activeSegment == null ? "var(--accent)" : "var(--border)"}`,
                    }}>כל הטיול</button>
                  {segs.map((s, i) => {
                    const on = activeSegment === i;
                    return (
                      <button key={s.id} onClick={() => { setActiveSegment(i); setActiveDay(null); }}
                        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition"
                        style={{
                          background: on ? "var(--accent)" : "var(--surface)",
                          color: on ? "#fff" : "var(--text-2)",
                          border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                        }}>
                        <span className="size-2.5 rounded-full" style={{ background: segColor(i) }} />
                        {s.cityHe || s.city}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mb-2 flex items-center justify-between px-0.5">
                <span className="text-[12.5px] text-[var(--text-2)]">
                  {activeDay != null ? `מציג: ${itinerary?.days[activeDay]?.label}`
                    : multiTrip && activeSegment != null ? `מציג: ${segs[activeSegment]?.cityHe || segs[activeSegment]?.city}`
                    : "מציג: כל הטיול"}
                  {" · "}{stopPoints.length} מקומות
                  {hotelPoints.length > 0 ? ` · ${hotelPoints.length} מלון` : ""}
                </span>
                {activeDay != null && (
                  <button onClick={() => setActiveDay(null)}
                    className="text-[12px] font-medium text-[var(--accent-ink)]">כל הימים</button>
                )}
              </div>
              <div className="h-[380px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
                <MapClient attractions={stopPoints} center={mapCenter} selected={null} ordered
                  hotels={hotelPoints} focus={focus}
                  segIdx={stopSegIdx} colorBySegment={multiTrip} />
              </div>
              <p className="mt-2 px-0.5 text-[11.5px] leading-snug text-[var(--text-3)]">
                <span className="text-[#0d9488]">🏨 המלון</span> תמיד מוצג · המספרים = סדר הביקור · הקו = מסלול ·
                {multiTrip ? " הצבע = אזור (מקטע)" : " הצבע = סוג"}
              </p>
            </div>
          )}
        </aside>

        {/* main column: error + days */}
        <div className="lg:order-1 lg:min-w-0 lg:flex-1">
      {error && (
        <div className="mx-5 mt-4 rounded-[var(--radius-card)] bg-[var(--amber-soft)] px-4 py-3 text-[13px] text-[var(--amber)] lg:mx-0">
          {error}
        </div>
      )}

      {itinerary && (
        <div className={`px-5 transition-opacity lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-8 lg:px-0 ${busy ? "opacity-50" : ""}`}>
          {itinerary.days.map((day, di) => (
            <section key={di} className="mt-7 lg:mt-0 lg:self-start">
              <div className="mb-3 flex items-center gap-2">
                <button onClick={() => setActiveDay(activeDay === di ? null : di)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-right">
                  <span className="text-[15px] font-bold transition-colors"
                    style={{ color: activeDay === di ? "var(--accent-ink)" : undefined }}>{day.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-3)]">· {day.date} · {day.base}</span>
                </button>
                {!editing && (
                  <button onClick={() => setActiveDay(activeDay === di ? null : di)}
                    className="hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition lg:flex"
                    style={{
                      background: activeDay === di ? "var(--accent)" : "var(--surface-2)",
                      color: activeDay === di ? "#fff" : "var(--text-2)",
                    }}>
                    <MapIcon size={12} /> {activeDay === di ? "מוצג במפה" : "הצג במפה"}
                  </button>
                )}
                {editing && (
                  <span className="flex shrink-0 gap-1">
                    <button onClick={() => moveDay(di, -1)} disabled={di === 0} aria-label="הזז יום למעלה"
                      className="grid size-7 place-items-center rounded-md bg-[var(--surface-2)] disabled:opacity-30"><ChevronUp size={15} /></button>
                    <button onClick={() => moveDay(di, 1)} disabled={di === itinerary.days.length - 1} aria-label="הזז יום למטה"
                      className="grid size-7 place-items-center rounded-md bg-[var(--surface-2)] disabled:opacity-30"><ChevronDown size={15} /></button>
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2.5">
                {day.stops.map((s, si) => {
                  const key = `${di}-${si}`;
                  const isOpen = expanded === key;
                  const hasDetails = !editing && !!(
                    s.image || s.website || s.bestTime || s.dress ||
                    s.cost != null || (s.tagline && s.tagline !== s.note)
                  );
                  return (
                  <div key={si} className="overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface)] shadow-[var(--shadow)]">
                    <div className={`flex items-start gap-3 p-3.5 ${hasDetails ? "cursor-pointer" : ""}`}
                         onClick={() => hasDetails && setExpanded(isOpen ? null : key)}>
                      <StopIcon kind={s.kind} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[15px] font-medium leading-tight">{s.name}</p>
                          <div className="flex shrink-0 items-center gap-2">
                            {!!s.score && (
                              <span className="flex items-center gap-0.5 text-[12px] font-medium text-[var(--accent-ink)]">
                                <Star size={13} fill="currentColor" /> {s.score}
                              </span>
                            )}
                            {hasDetails && (
                              <ChevronDown size={16}
                                className={`text-[var(--text-3)] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            )}
                          </div>
                        </div>
                        <p className="mt-0.5 text-[12px] text-[var(--text-3)]">{s.time} · {s.duration}</p>
                        {s.note && <p className="mt-1.5 text-[13px] leading-snug text-[var(--text-2)]">{s.note}</p>}
                        {editing && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2.5">
                            <button onClick={() => moveStop(di, si, -1)} disabled={si === 0} aria-label="העלה"
                              className="grid size-7 place-items-center rounded-md bg-[var(--surface-2)] disabled:opacity-30"><ChevronUp size={15} /></button>
                            <button onClick={() => moveStop(di, si, 1)} disabled={si === day.stops.length - 1} aria-label="הורד"
                              className="grid size-7 place-items-center rounded-md bg-[var(--surface-2)] disabled:opacity-30"><ChevronDown size={15} /></button>
                            <span className="mx-1 h-4 w-px bg-[var(--border)]"></span>
                            <button onClick={() => moveStopToDay(di, si, -1)} disabled={di === 0}
                              className="flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-1 text-[11px] disabled:opacity-30">
                              <ChevronsUp size={13} /> ליום הקודם
                            </button>
                            <button onClick={() => moveStopToDay(di, si, 1)} disabled={di === itinerary.days.length - 1}
                              className="flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-1 text-[11px] disabled:opacity-30">
                              <ChevronsDown size={13} /> ליום הבא
                            </button>
                            <button onClick={() => deleteStop(di, si)} aria-label="מחק"
                              className="mr-auto grid size-7 place-items-center rounded-md text-[var(--text-3)]"><Trash2 size={15} /></button>
                          </div>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-[var(--border)] px-3.5 pb-4 pt-3">
                        {s.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={bigImage(s.image)} alt="" loading="lazy"
                            onError={(e) => { const t = e.currentTarget; if (s.image && t.src !== s.image) t.src = s.image; }}
                            className="mb-3 aspect-[4/3] w-full rounded-[10px] object-cover" />
                        )}
                        {s.tagline && s.tagline !== s.note && (
                          <p className="mb-2 text-[13.5px] italic text-[var(--text-2)]">{s.tagline}</p>
                        )}
                        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-[var(--text-2)]">
                          {s.bestTime && <span><span className="text-[var(--text-3)]">מתי: </span>{s.bestTime}</span>}
                          {s.dress && <span><span className="text-[var(--text-3)]">לבוש: </span>{s.dress}</span>}
                          {s.cost != null && <span><span className="text-[var(--text-3)]">עלות: </span>{COST_HE[s.cost] ?? ""}</span>}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {s.website && (
                            <a href={s.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[12.5px] text-[var(--blue)]">
                              <ExternalLink size={13} /> אתר רשמי
                            </a>
                          )}
                          {s.lat != null && s.lng != null && (
                            <a href={googleMapsUrl(s.lat, s.lng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[12.5px] text-[var(--text-2)]">
                              <Navigation size={13} /> פתח במפה
                            </a>
                          )}
                        </div>
                        {!s.website && !s.image && s.lat == null && (
                          <p className="text-[12.5px] text-[var(--text-3)]">אין פרטים נוספים למקום הזה</p>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
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
        </div>
      </div>

      {itinerary && (
        <AskBar onSend={revise} busy={busy === "revise"}
          days={dayLabels} todayIndex={todayIndex} tomorrowIndex={tomorrowIndex} />
      )}
    </main>
  );
}
