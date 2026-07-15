"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ChevronRight, Mountain, Utensils, Landmark, Coffee, ShoppingBag,
  Sparkles, Star, Loader2, Pencil, ChevronUp, ChevronDown,
  ChevronsUp, ChevronsDown, Trash2, ExternalLink, Navigation, Map as MapIcon, Route, Users, Luggage, ListChecks, Wallet, CalendarDays,
  PersonStanding, Clock, MapPin, Ruler, Footprints,
} from "lucide-react";
import { googleMapsUrl, haversineKm, formatDistance } from "@/lib/geo";
import { stopColor } from "@/lib/labels";
import { bigImage } from "@/lib/labels";
import { KIND_META } from "@/lib/sample";
import type { Itinerary, Stop } from "@/lib/trip-types";
import type { Attraction } from "@/lib/db";
import { useTrips, useProfile, useHotels, profileText, profileSummary, MONTHS_HE, datesToInfo } from "@/lib/store";
import { deriveTaste } from "@/lib/taste";
import { ProfileEditor } from "@/components/ProfileEditor";
import { WhyFits } from "@/components/Signature";
import { MapArt } from "@/components/Illustrations";
import { CityPoster } from "@/components/CityPoster";
import { PackingList } from "@/components/PackingList";
import { TravelChecklist } from "@/components/TravelChecklist";
import { BudgetPanel } from "@/components/BudgetPanel";
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

// Trip tools (#15 #17 #18) — a compact submenu instead of three stacked cards.
const TOOLS = [
  { key: "packing", label: "מה לארוז", Icon: Luggage },
  { key: "checklist", label: "לפני שיוצאים", Icon: ListChecks },
  { key: "budget", label: "תקציב", Icon: Wallet },
] as const;
type ToolKey = (typeof TOOLS)[number]["key"];

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
  const [tool, setTool] = useState<ToolKey | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState(0);                 // one day on screen — pager
  const [mobileTab, setMobileTab] = useState<"plan" | "map">("plan");
  const [focus, setFocus] = useState<{ lat: number; lng: number; n: number } | null>(null);
  // The stop the user is pointing at — hovered in the list or clicked on the map.
  // Indexed in "located stop" space (matches the numbered map markers).
  const [active, setActive] = useState<number | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  // Row refs so a map-marker click can scroll its timeline card into view.
  const stopRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Destinations, for picking a target city when there's no hotel yet.
  const [dests, setDests] = useState<{ id: number; city: string; country: string; city_he: string | null }[]>([]);
  useEffect(() => {
    fetch("/api/destinations").then((r) => r.json())
      .then((d) => setDests(d.destinations ?? [])).catch(() => {});
  }, []);
  const COST_HE = ["חינם", "₪", "₪₪", "₪₪₪"];

  const trip = trips.find((t) => t.id === tripId);
  const itinerary = trip?.itinerary ?? null;
  // Trip built from an Explore selection → show the two tiers (anchor / "אם יש זמן").
  const fromSelection = !!trip?.selection;
  // Per-trip travelers override the global profile (different group per trip).
  const tripProfile = trip?.profile ?? globalProfile;
  const tripHotels = hotels.filter((h) => h.tripId === tripId);
  // City for attractions/API: English destination, or derived from a linked hotel.
  const city = trip?.city || tripHotels[0]?.city;
  // Can build once we know WHERE: a destination (preferences) or a located hotel
  // (hotels mode) — the API resolves the area from the hotel's coordinates even
  // when the geocoder returned no city name.
  const hotelLocated = tripHotels.some((h) => h.lat != null && h.lng != null);
  const canBuild = !!trip?.city || !!trip?.destinationId || hotelLocated;
  // City for display: Hebrew (hotel city from geocode is already Hebrew).
  const cityHe = trip?.cityHe || tripHotels[0]?.city || trip?.city;

  // Segments (legs) of a multi-city trip.
  const segs = trip?.segments ?? [];
  const multiTrip = segs.length > 1;

  // One day on screen at a time — pager index, clamped to the day count.
  const allDays = itinerary?.days ?? [];
  const curIdx = Math.min(dayIdx, Math.max(0, allDays.length - 1));
  const day = allDays.length ? allDays[curIdx] : null;

  // The map shows only the selected day's stops — all days at once is noise.
  const mapStops = (day?.stops ?? []).filter((s) => s.lat != null && s.lng != null);
  const stopPoints = mapStops.map((s, i) => ({
    id: i, name_he: s.name, name_en: s.name, lat: s.lat!, lng: s.lng!,
    category: KIND_TO_CAT[s.kind] ?? "attraction", subcategory: null,
    indoor_outdoor: null, family_score: s.score ?? null, tips_he: null,
    website: s.website ?? null, duration_minutes: null, image_url: s.image ?? null,
    tagline_he: s.tagline ?? null, best_season: null, best_time_he: s.bestTime ?? null,
    dress_he: null, cost_level: s.cost ?? null, must_see: null,
  })) as Attraction[];
  // Give every LOCATED stop a stable index in the same order the map numbers
  // them, so a stop's colour + number match across the timeline and the map.
  // Stops without coords (a bare meal/rest) get no number — colorIdx = null.
  let _li = -1;
  const colorIdxByStop: (number | null)[] = (day?.stops ?? []).map((s) =>
    s.lat != null && s.lng != null ? ++_li : null);
  // Reverse: located index → its position in day.stops (for map-marker clicks).
  const locatedToStop: number[] = [];
  colorIdxByStop.forEach((ci, si) => { if (ci != null) locatedToStop[ci] = si; });
  const stopColors = mapStops.map((_, i) => stopColor(i));

  // Walking legs between consecutive located stops — a straight-line distance
  // with a ~1.35 street-detour factor, at ~4.6 km/h. An honest estimate (not a
  // routed path), keyed to a stop's index so it renders in the gap below it.
  const legAfter: Record<number, { km: number; min: number }> = {};
  const dstops = day?.stops ?? [];
  for (let si = 0; si < dstops.length - 1; si++) {
    const a = dstops[si], b = dstops[si + 1];
    if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng) * 1.35;
    legAfter[si] = { km, min: Math.max(1, Math.round((km / 4.6) * 60)) };
  }
  const dayTotalKm = Object.values(legAfter).reduce((s, l) => s + l.km, 0);
  const dayTotalWalkMin = Object.values(legAfter).reduce((s, l) => s + l.min, 0);
  const dayStart = dstops[0]?.time;
  const dayEnd = dstops[dstops.length - 1]?.time;

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
  // AI labels carry the day's theme ("יום 2 — פארק רטירו…") — chips show only
  // the short "יום N"; the full title lives in the day header below.
  const shortDay = (i: number) =>
    (dayLabels[i] ?? `יום ${i + 1}`).split(/[—–]/)[0].trim() || `יום ${i + 1}`;
  const dayCount = dayLabels.length;
  const startISO = tripHotels.map((h) => h.checkIn).filter(Boolean).sort()[0];
  const startDate = startISO ? new Date(startISO + "T00:00:00") : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayDate = (i: number) => (startDate ? new Date(startDate.getTime() + i * 86400000) : null);
  const endDate = startDate && dayCount ? dayDate(dayCount - 1) : null;
  const isLive = !!(startDate && endDate && today >= startDate && today <= endDate);
  const todayIndex = isLive ? Math.round((today.getTime() - startDate!.getTime()) / 86400000) : null;
  const tomorrowIndex = todayIndex != null && todayIndex + 1 < dayCount ? todayIndex + 1 : null;

  // Live trip → open on today's day.
  useEffect(() => {
    if (isLive && todayIndex != null) setDayIdx(todayIndex);
  }, [isLive, todayIndex]);

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
        body: JSON.stringify({ city, profileText: profileText(tripProfile),
          taste: deriveTaste(tripProfile), isFamily: tripProfile.kids.length > 0, ...payload }),
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
    selection: trip?.selection,   // Explore build: anchors-first, "אם יש זמן" fillers (F1)
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
  const moveDay = (di: number, dir: -1 | 1) => {
    mutate((it) => swap(it.days, di, di + dir));
    const tgt = di + dir;                       // follow the day the user is moving
    if (tgt >= 0 && tgt < allDays.length) setDayIdx(tgt);
  };
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
        <Link href="/trips" className="mt-3 inline-block text-[15px] text-[var(--accent-ink)]">← לכל הטיולים</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[440px] pb-16 lg:max-w-6xl">
      {/* compact header card — data beside a square poster; map + days stay above the fold */}
      <div className="px-5 pt-2 lg:px-8 lg:pt-2.5">
        <Link href="/trips" className="eyebrow mb-1.5 inline-flex items-center gap-1 text-[var(--text-2)]">
          <ChevronRight size={14} /> הטיולים שלי
        </Link>
        {/* compact hero — a wide LANDSCAPE thumbnail beside tight trip data, so
            the day tabs + map + timeline all sit above the fold */}
        <header className="rise flex overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface)] shadow-[var(--shadow)]">
          {/* landscape thumbnail (wide, not tall) */}
          <div className="relative w-[150px] shrink-0 sm:w-[240px] lg:w-[300px]">
            <CityPoster destinationId={trip?.destinationId} cityHe={cityHe}
              orientation="landscape" position="50% 45%" className="absolute inset-0 size-full" />
          </div>

          {/* body: title + meta + actions on one line, dates tucked under */}
          <div className="min-w-0 flex-1 p-3 lg:px-4 lg:py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="serif text-[20px] font-bold leading-tight lg:text-[24px]">{trip?.title ?? "…"}</h1>
                <p className="mt-0.5 text-[14px] text-[var(--text-2)]">
                  {trip?.segments && trip.segments.length > 1
                    ? `${trip.segments.map((s) => s.cityHe || s.city).join(" → ")} · `
                    : cityHe ? `${cityHe} · ` : ""}
                  {trip?.days} ימים
                  {trip?.month ? ` · ${MONTHS_HE[trip.month - 1]}` : ""}
                  {trip?.segments && trip.segments.length > 1 ? ` · ${trip.segments.length} ערים` : ""}
                  {trip?.mode === "hotels" ? " · טיול כוכב" : ""}
                </p>
                <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-3)]">
                  נוסעים: {profileSummary(tripProfile)}{trip?.profile ? "" : " · ברירת מחדל"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <button onClick={generate} disabled={!!busy || !canBuild}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-[14.5px] font-medium text-white disabled:opacity-50">
                  {busy === "generate" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {busy === "generate" ? "בונה…" : itinerary ? "בנה מחדש" : "בנה לו\"ז"}
                </button>
                <button onClick={() => setEditTravelers((v) => !v)}
                  className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--brand)] px-3.5 py-2 text-[14.5px] font-medium"
                  style={{ background: editTravelers ? "var(--brand-soft)" : "var(--surface)", color: "var(--brand-ink)" }}>
                  <Users size={14} /> מי נוסע
                </button>
              </div>
            </div>

            {/* exact dates → powers season, length and (soon) the live-events feed (#64) */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--text-2)]">
              <CalendarDays size={14} className="text-[var(--text-3)]" />
              <span>תאריכים:</span>
              <input type="date" value={trip?.startDate ?? ""}
                onChange={(e) => {
                  const info = datesToInfo(e.target.value, trip?.endDate);
                  update(tripId, { startDate: e.target.value || undefined, ...(info ? { days: info.days, month: info.month } : {}) });
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[13px] text-[var(--text)] outline-none" />
              <span>–</span>
              <input type="date" value={trip?.endDate ?? ""} min={trip?.startDate}
                onChange={(e) => {
                  const info = datesToInfo(trip?.startDate, e.target.value);
                  update(tripId, { endDate: e.target.value || undefined, ...(info ? { days: info.days, month: info.month } : {}) });
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[13px] text-[var(--text)] outline-none" />
            </div>
          </div>
        </header>
      </div>

      {/* expandable panels — sit below the hero on the page canvas */}
      {(editTravelers || (!canBuild && !multiTrip)) && (
        <div className="px-5 pt-4 lg:px-8">
          {editTravelers && (
            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] lg:max-w-2xl">
              <p className="mb-3 text-[14px] text-[var(--text-2)]">
                מי נוסע בטיול <span className="font-medium">הזה</span>? משפיע על מה שה-AI יבנה (טיול עם הילדים שונה מטיול זוגי) — לא משנה את הפרופיל הכללי.
              </p>
              <ProfileEditor value={tripProfile} onChange={(p) => update(tripId, { profile: p })} />
              {trip?.profile && (
                <button onClick={() => update(tripId, { profile: undefined })}
                  className="mt-4 text-[13px] text-[var(--accent-ink)] underline">אפס לפרופיל הכללי</button>
              )}
            </div>
          )}

          {!canBuild && !multiTrip && (
            <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)] lg:max-w-xl">
              <p className="mb-2 text-[14px] text-[var(--text-2)]">
                לאן הטיול? בחרו עיר ונבנה לו״ז סביב מרכז העיר — או הוסיפו מלון (למטה) לטיול-כוכב מדויק יותר.
              </p>
              <select value={trip?.destinationId ?? ""}
                onChange={(e) => {
                  const d = dests.find((x) => String(x.id) === e.target.value);
                  if (d) update(tripId, { city: d.city, cityHe: d.city_he || d.city, country: d.country, destinationId: d.id });
                }}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[15px] text-[var(--text)] outline-none">
                <option value="">{dests.length ? "בחרו עיר יעד…" : "טוען ערים…"}</option>
                {dests.map((d) => (
                  <option key={d.id} value={d.id}>{(d.city_he || d.city)} · {d.country}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── full-width day navigation + summary — spans BOTH columns (#3 #4) ── */}
      {itinerary && day && (
        <div className="px-5 pt-2 lg:px-8 lg:pt-2.5">
          {/* wide day tabs: number · date · stop count; selected = brand green */}
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0"
               style={{ scrollbarWidth: "none" }}>
            {allDays.map((d, i) => {
              const on = i === curIdx;
              const dd = dayDate(i);
              return (
                <button key={i} onClick={() => { setDayIdx(i); setExpanded(null); setActive(null); }}
                  className="min-w-[116px] shrink-0 rounded-[var(--radius-sm)] border px-4 py-2.5 text-right transition"
                  style={{ background: on ? "var(--brand)" : "var(--surface)",
                           borderColor: on ? "var(--brand)" : "var(--border)",
                           boxShadow: on ? "var(--shadow)" : "none" }}>
                  <span className="block text-[15px] font-semibold leading-tight"
                        style={{ color: on ? "#fff" : "var(--text)" }}>
                    יום {i + 1}{i === todayIndex ? " · היום" : ""}
                  </span>
                  <span className="mt-0.5 block text-[12.5px]"
                        style={{ color: on ? "rgba(255,255,255,.85)" : "var(--text-3)" }}>
                    {dd ? dd.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) : ""}
                    {dd ? " · " : ""}{d.stops.length} תחנות
                  </span>
                </button>
              );
            })}
          </div>

          {/* day summary toolbar: theme + at-a-glance stats + day actions */}
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <h2 className="serif truncate text-[18px] font-bold leading-tight lg:text-[20px]">{dayLabels[curIdx]}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-[var(--text-2)]">
                <span className="flex items-center gap-1"><MapPin size={13} className="text-[var(--text-3)]" /> {stopPoints.length} תחנות</span>
                {dayTotalKm > 0 && <span className="flex items-center gap-1"><Ruler size={13} className="text-[var(--text-3)]" /> {formatDistance(dayTotalKm)}</span>}
                {dayTotalWalkMin > 0 && <span className="flex items-center gap-1"><Footprints size={13} className="text-[var(--text-3)]" /> ~{dayTotalWalkMin} דק׳ הליכה</span>}
                {dayStart && dayEnd && <span className="flex items-center gap-1" dir="ltr"><Clock size={13} className="text-[var(--text-3)]" /> {dayStart}–{dayEnd}</span>}
                {day.base && <span className="flex items-center gap-1"><Navigation size={13} className="text-[var(--text-3)]" /> {day.base}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {editing && (
                <span className="flex gap-1">
                  <button onClick={() => moveDay(curIdx, -1)} disabled={curIdx === 0} aria-label="הקדם את היום"
                    className="grid size-8 place-items-center rounded-md bg-[var(--surface-2)] disabled:opacity-30"><ChevronUp size={15} /></button>
                  <button onClick={() => moveDay(curIdx, 1)} disabled={curIdx === allDays.length - 1} aria-label="אחר את היום"
                    className="grid size-8 place-items-center rounded-md bg-[var(--surface-2)] disabled:opacity-30"><ChevronDown size={15} /></button>
                </span>
              )}
              <button onClick={() => setEditing((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[14px] font-medium transition"
                style={{ background: editing ? "var(--accent-soft)" : "var(--surface)",
                         borderColor: editing ? "var(--accent)" : "var(--border)",
                         color: editing ? "var(--accent-ink)" : "var(--text-2)" }}>
                <Pencil size={14} /> {editing ? "סיום עריכה" : "שינוי סדר"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="lg:flex lg:items-start lg:gap-8 lg:px-8 lg:pt-2">
        {/* main column (right on desktop): the day timeline */}
        <div className="lg:min-w-0 lg:flex-1">
      {error && (
        <div className="mx-5 mt-4 rounded-[var(--radius-card)] bg-[var(--amber-soft)] px-4 py-3 text-[14px] text-[var(--amber)] lg:mx-0">
          {error}
        </div>
      )}

      {/* branded building moment — generation really takes ~a minute */}
      {busy === "generate" && (
        <div className="mx-5 mt-5 flex flex-col items-center rounded-[var(--radius-card)] bg-[var(--surface)] px-5 py-8 text-center shadow-[var(--shadow)] lg:mx-0">
          <MapArt width={200} />
          <p className="serif mt-3 text-[20px] font-semibold">בונים לכם את הטיול המושלם…</p>
          <div className="mt-3 flex flex-col items-start gap-1.5 text-[14px] text-[var(--text-2)]">
            {["מתאים להעדפות ולטעם שלכם",
              ...(trip?.selection ? ["כל יום נפתח בעוגן שבחרתם"] : []),
              "בונים לפי מרחק וזמן",
              "מאוזן ומגוון נכון"].map((t) => (
              <p key={t} className="flex items-center gap-1.5">
                <span className="grid size-4 place-items-center rounded-full bg-[var(--brand)] text-[11px] text-white">✓</span> {t}
              </p>
            ))}
          </div>
          <div className="mt-5 h-2 w-56 overflow-hidden rounded-full bg-[var(--surface-2)]" dir="ltr">
            <div className="progress-slide h-full w-1/3 rounded-full bg-[var(--brand)]" />
          </div>
        </div>
      )}

      {itinerary && day && (
        <div className={`px-5 transition-opacity lg:px-0 ${busy ? "opacity-50" : ""}`}>
          {/* mobile: route / map tabs (desktop shows the map beside) */}
          <div className="mt-4 flex rounded-full bg-[var(--surface-2)] p-1 lg:hidden">
            {([["plan", "מסלול", Route], ["map", "מפה", MapIcon]] as const).map(([k, l, I]) => (
              <button key={k} onClick={() => setMobileTab(k)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[14.5px] font-medium transition"
                style={{ background: mobileTab === k ? "var(--surface)" : "transparent",
                         color: mobileTab === k ? "var(--brand-ink)" : "var(--text-2)",
                         boxShadow: mobileTab === k ? "var(--shadow)" : "none" }}>
                <I size={15} /> {l}
              </button>
            ))}
          </div>

          {/* mobile map tab — the selected day only */}
          {mobileTab === "map" && (
            <div className="mt-3 h-[420px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] lg:hidden">
              <MapClient attractions={stopPoints} center={mapCenter} selected={null} ordered
                hotels={hotelPoints} focus={focus} colors={stopColors} activeIdx={active}
                onStopClick={(li) => { const si = locatedToStop[li]; if (si == null) return;
                  setExpanded(`${curIdx}-${si}`); setActive(li); setMobileTab("plan"); }} />
            </div>
          )}

          {/* the day as a timeline — photo · stop · numbered spine · time */}
          <div className={mobileTab === "map" ? "hidden lg:block" : ""}>
            <div className="mt-3 rounded-[var(--radius-card)] bg-[var(--surface)] px-3 shadow-[var(--shadow)] lg:mt-0 lg:px-4">
              {day.stops.map((s, si) => {
                const key = `${curIdx}-${si}`;
                const isOpen = expanded === key;
                const hasDetails = !editing && !!(
                  s.image || s.website || s.bestTime || s.dress ||
                  s.cost != null || (s.tagline && s.tagline !== s.note)
                );
                const first = si === 0;
                const last = si === day.stops.length - 1;
                const spine = "var(--border)";
                const ci = colorIdxByStop[si];                 // located index (map order)
                const col = ci != null ? stopColor(ci) : "var(--text-3)";
                const isActive = ci != null && active === ci;
                const leg = legAfter[si];
                return (
                  <div key={si} ref={(el) => { stopRefs.current[si] = el; }}>
                    <div className={`flex gap-3 rounded-[12px] transition ${hasDetails ? "cursor-pointer" : ""}`}
                         style={{ background: isActive ? `color-mix(in srgb, ${col} 8%, transparent)` : undefined }}
                         onMouseEnter={() => ci != null && setActive(ci)}
                         onMouseLeave={() => setActive(null)}
                         onClick={() => hasDetails && setExpanded(isOpen ? null : key)}>
                      {/* photo (falls back to the kind icon) */}
                      <div className="py-3.5 pr-1">
                        {s.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.image} alt="" loading="lazy"
                            className="size-14 rounded-[12px] object-cover" />
                        ) : (
                          <StopIcon kind={s.kind} />
                        )}
                      </div>
                      {/* name + details */}
                      <div className="min-w-0 flex-1 py-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-[16px] font-medium leading-tight">{s.name}</p>
                            {fromSelection && s.anchor === true && (
                              <span className="shrink-0 rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--brand-ink)]">עוגן</span>
                            )}
                            {fromSelection && s.anchor === false && (
                              <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-3)]">אם יש זמן</span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {/* fixed-width so the star column lines up across every row */}
                            <span className="flex min-w-[34px] items-center justify-end gap-1 text-[13px] font-medium text-[var(--accent-ink)]">
                              {!!s.score && (<><Star size={13} fill="currentColor" /><span className="tabular-nums">{s.score}</span></>)}
                            </span>
                            {/* chevron slot is always present (empty when no details) so
                                the rating doesn't shift between expandable / plain rows */}
                            <span className="grid w-4 place-items-center">
                              {hasDetails && (
                                <ChevronDown size={16}
                                  className={`text-[var(--text-3)] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                              )}
                            </span>
                          </div>
                        </div>
                        {s.duration && <p className="mt-0.5 text-[13px] text-[var(--text-3)]">{s.duration}</p>}
                        {s.note && <p className={`mt-1 text-[13.5px] leading-snug text-[var(--text-2)] ${isOpen ? "" : "line-clamp-2"}`}>{s.note}</p>}
                        {editing && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2.5"
                               onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => moveStop(curIdx, si, -1)} disabled={si === 0} aria-label="העלה"
                              className="grid size-7 place-items-center rounded-md bg-[var(--surface-2)] disabled:opacity-30"><ChevronUp size={15} /></button>
                            <button onClick={() => moveStop(curIdx, si, 1)} disabled={si === day.stops.length - 1} aria-label="הורד"
                              className="grid size-7 place-items-center rounded-md bg-[var(--surface-2)] disabled:opacity-30"><ChevronDown size={15} /></button>
                            <span className="mx-1 h-4 w-px bg-[var(--border)]"></span>
                            <button onClick={() => moveStopToDay(curIdx, si, -1)} disabled={curIdx === 0}
                              className="flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-1 text-[12px] disabled:opacity-30">
                              <ChevronsUp size={13} /> ליום הקודם
                            </button>
                            <button onClick={() => moveStopToDay(curIdx, si, 1)} disabled={curIdx === allDays.length - 1}
                              className="flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-1 text-[12px] disabled:opacity-30">
                              <ChevronsDown size={13} /> ליום הבא
                            </button>
                            <button onClick={() => deleteStop(curIdx, si)} aria-label="מחק"
                              className="mr-auto grid size-7 place-items-center rounded-md text-[var(--text-3)]"><Trash2 size={15} /></button>
                          </div>
                        )}
                      </div>
                      {/* timeline spine — a numbered dot in the stop's own colour */}
                      <div className="flex w-7 shrink-0 flex-col items-center">
                        <div className="min-h-[16px] w-px flex-1" style={{ background: first ? "transparent" : spine }} />
                        {ci != null ? (
                          <span className="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white transition"
                            style={{ background: col, boxShadow: isActive ? `0 0 0 3px color-mix(in srgb, ${col} 30%, transparent)` : "none" }}>
                            {ci + 1}
                          </span>
                        ) : (
                          <span className="size-2.5 shrink-0 rounded-full bg-[var(--text-3)]" />
                        )}
                        <div className="min-h-[16px] w-px flex-1" style={{ background: last ? "transparent" : spine }} />
                      </div>
                      {/* time */}
                      <div className="w-11 shrink-0 py-3.5">
                        <p className="text-[14px] font-semibold text-[var(--text-2)]" dir="ltr">{s.time}</p>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-[var(--border)] pb-4 pt-3">
                        {s.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={bigImage(s.image)} alt="" loading="lazy"
                            onError={(e) => { const t = e.currentTarget; if (s.image && t.src !== s.image) t.src = s.image; }}
                            className="mb-3 aspect-[4/3] w-full rounded-[10px] object-cover" />
                        )}
                        {s.tagline && s.tagline !== s.note && (
                          <p className="mb-2 text-[14.5px] italic text-[var(--text-2)]">{s.tagline}</p>
                        )}
                        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13.5px] text-[var(--text-2)]">
                          {s.bestTime && <span><span className="text-[var(--text-3)]">מתי: </span>{s.bestTime}</span>}
                          {s.dress && <span><span className="text-[var(--text-3)]">לבוש: </span>{s.dress}</span>}
                          {s.cost != null && <span><span className="text-[var(--text-3)]">עלות: </span>{COST_HE[s.cost] ?? ""}</span>}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {s.website && (
                            <a href={s.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[13.5px] text-[var(--blue)]">
                              <ExternalLink size={13} /> אתר רשמי
                            </a>
                          )}
                          {s.lat != null && s.lng != null && (
                            <a href={googleMapsUrl(s.lat, s.lng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[13.5px] text-[var(--text-2)]">
                              <Navigation size={13} /> פתח במפה
                            </a>
                          )}
                        </div>
                        {!s.website && !s.image && s.lat == null && (
                          <p className="text-[13.5px] text-[var(--text-3)]">אין פרטים נוספים למקום הזה</p>
                        )}
                      </div>
                    )}

                    {/* transport to the next stop — a straight-line walking estimate */}
                    {leg && !editing && !last && (
                      <div className="flex items-stretch gap-3">
                        <div className="w-14 shrink-0 pr-1" />
                        <div className="min-w-0 flex-1 py-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[12.5px] text-[var(--text-2)]">
                            <PersonStanding size={13} /> ~{leg.min} דק׳ הליכה · {formatDistance(leg.km)}
                          </span>
                        </div>
                        <div className="flex w-7 shrink-0 justify-center">
                          <div className="w-px border-l border-dashed border-[var(--border)]" />
                        </div>
                        <div className="w-11 shrink-0" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* why this day is shaped this way — AI insight + quick reshapes */}
            {day.why && (
              <div className="mt-3">
                <WhyFits title="למה בנינו את היום ככה">{day.why}</WhyFits>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    { t: "תעשה את היום רגוע ופחות עמוס יותר", l: "קצב רגוע יותר" },
                    { t: "צמצם את ההליכה בין המקומות", l: "פחות הליכה" },
                    { t: "הוסף עצירת אוכל טובה במיקום שמתאים למסלול", l: "הוסף אוכל" },
                  ].map((q) => (
                    <button key={q.l} disabled={!!busy}
                      onClick={() => revise(`שנה אך ורק את ${dayLabels[curIdx]} (היום ה-${curIdx + 1} בטיול), אל תיגע בשאר הימים. ${q.t}`)}
                      className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[13px] text-[var(--text-2)] transition hover:border-[var(--brand)] disabled:opacity-50">
                      <Sparkles size={12} className="text-[var(--brand)]" /> {q.l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* revise with AI — in the flow, right under the day */}
          <AskBar onSend={revise} busy={busy === "revise"}
            days={dayLabels} todayIndex={todayIndex} tomorrowIndex={tomorrowIndex} />
        </div>
      )}
        </div>

        {/* aside (left on desktop, ~46% wide): the day's map + hotels + trip tools */}
        <aside className="lg:sticky lg:top-[73px] lg:w-[46%] lg:shrink-0">
          {/* map of the selected day — desktop; mobile uses the מפה tab */}
          {(stopPoints.length > 0 || hotelPoints.length > 0) && (
            <div className="hidden lg:block">
              <div className="relative">
                <div className="h-[520px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
                  <MapClient attractions={stopPoints} center={mapCenter} selected={null} ordered
                    hotels={hotelPoints} focus={focus} colors={stopColors} activeIdx={active}
                    onStopClick={(li) => { const si = locatedToStop[li]; if (si == null) return;
                      setExpanded(`${curIdx}-${si}`); setActive(li);
                      requestAnimationFrame(() => stopRefs.current[si]?.scrollIntoView({ behavior: "smooth", block: "center" })); }} />
                </div>

                {/* legend — a collapsible floating card tying numbers to names */}
                {stopPoints.length > 0 && (
                  <div className="absolute bottom-3 left-3 z-[1000] w-[210px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] shadow-[var(--shadow)]"
                       style={{ background: "var(--surface)" }}>
                    <button onClick={() => setLegendOpen((o) => !o)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium text-[var(--text-2)]">
                      <span>מקרא · {stopPoints.length} תחנות</span>
                      <ChevronDown size={14} className={`transition-transform ${legendOpen ? "" : "rotate-180"}`} />
                    </button>
                    {legendOpen && (
                      <div className="max-h-[220px] overflow-y-auto px-2 pb-2">
                        {mapStops.map((s, i) => {
                          const on = active === i;
                          return (
                            <button key={i}
                              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
                              onClick={() => { const si = locatedToStop[i]; if (si == null) return;
                                setExpanded(`${curIdx}-${si}`);
                                requestAnimationFrame(() => stopRefs.current[si]?.scrollIntoView({ behavior: "smooth", block: "center" })); }}
                              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-right text-[13px] transition"
                              style={{ background: on ? "var(--surface-2)" : "transparent" }}>
                              <span className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                                    style={{ background: stopColor(i) }}>{i + 1}</span>
                              <span className="truncate text-[var(--text-2)]">{s.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <p className="mt-2 px-0.5 text-[12.5px] leading-snug text-[var(--text-3)]">
                {day ? `${shortDay(curIdx)} · ${stopPoints.length} מקומות · ` : ""}
                <span className="text-[var(--brand)]">🏨 המלון</span> תמיד מוצג · המספרים = סדר הביקור · הקו = מסלול
              </p>
            </div>
          )}

          <div className="px-5 pt-6 lg:px-0 lg:pt-5">
            <Hotels tripId={tripId} segments={trip?.segments} countryHint={trip?.country}
              onFocus={(h) => h.lat != null && h.lng != null && setFocus({ lat: h.lat, lng: h.lng, n: Date.now() })} />
          </div>

          {/* trip tools — a compact submenu; panels open only on demand */}
          <div className="mt-5 px-5 lg:px-0">
            <div className="flex flex-wrap gap-2">
              {TOOLS.map(({ key, label, Icon }) => {
                const on = tool === key;
                return (
                  <button key={key} onClick={() => setTool(on ? null : key)}
                    className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[14px] font-medium shadow-[var(--shadow)] transition"
                    style={{ background: on ? "var(--brand-soft)" : "var(--surface)",
                             color: on ? "var(--brand-ink)" : "var(--text-2)" }}>
                    <Icon size={15} /> {label}
                  </button>
                );
              })}
            </div>
            {tool && (
              <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
                {tool === "packing" && (
                  <PackingList
                    profile={tripProfile} month={trip?.month} days={trip?.days ?? 4} country={trip?.country}
                    value={trip?.packing}
                    onChange={(packing) => update(tripId, { packing })} />
                )}
                {tool === "checklist" && (
                  <TravelChecklist
                    profile={tripProfile}
                    value={trip?.checklist}
                    onChange={(checklist) => update(tripId, { checklist })} />
                )}
                {tool === "budget" && (
                  <BudgetPanel
                    itinerary={itinerary} profile={tripProfile}
                    value={trip?.budget}
                    onChange={(budget) => update(tripId, { budget })} />
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
