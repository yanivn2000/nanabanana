"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight, ChevronLeft, Mountain, Utensils, Landmark, Coffee, ShoppingBag,
  Sparkles, Star, Loader2, ChevronDown,
  Trash2, ExternalLink, Navigation, Map as MapIcon, Route, Users, Luggage, ListChecks, Wallet, CalendarDays,
  Clock, MapPin, Ruler, Footprints, Copy, Lightbulb, Car, Hourglass, GripVertical,
} from "lucide-react";

// Render a stop's stay time cleanly. New builds already store natural Hebrew
// (durationHe: "כשעה", "כ-45 דק׳") — pass those through. Older trips stored
// "N שעות" (which rounded sub-hour stops to "0 שעות"); normalise those here so no
// existing trip shows a broken duration.
function stayHe(d?: string): string | null {
  if (!d) return null;
  if (/דק|כ|חצי/.test(d)) return d;       // already clean (new format) or "שעה" lunch
  const m = d.match(/^([\d.]+)\s*שעות?/);
  if (!m) return d;
  const n = parseFloat(m[1]);
  if (n === 0) return "פחות משעה";
  if (n === 1) return "כשעה";
  if (n === 1.5) return "כשעה וחצי";
  if (n === 2) return "כשעתיים";
  if (n === 2.5) return "כשעתיים וחצי";
  return `כ-${n} שעות`;
}
import { googleMapsUrl, googleDirUrl, formatDistance, estimateLeg, haversineKm, travelMinutes, durationHe, DEFAULT_WALK_PREF, type Leg } from "@/lib/geo";
import { stopColor } from "@/lib/labels";
import { bigImage } from "@/lib/labels";
import { KIND_META } from "@/lib/sample";
import type { Itinerary, Stop } from "@/lib/trip-types";
import type { Attraction } from "@/lib/db";
import { useTrips, useProfile, useHotels, profileText, profileSummary, MONTHS_HE, datesToInfo } from "@/lib/store";
import { deriveTaste } from "@/lib/taste";
import { ProfileEditor } from "@/components/ProfileEditor";
import { ShareTrip } from "@/components/ShareTrip";
import { MapArt } from "@/components/Illustrations";
import { CityPoster } from "@/components/CityPoster";
import { PackingList } from "@/components/PackingList";
import { TravelChecklist } from "@/components/TravelChecklist";
import { BudgetPanel } from "@/components/BudgetPanel";
import { Hotels } from "@/app/trips/Hotels";
import { EditorTools } from "./EditorTools";
import { MapClient } from "@/components/MapClient";
import { AskBar } from "./AskBar";

const KIND_TO_CAT: Record<string, string> = {
  nature: "nature", food: "food", culture: "museum", shopping: "shopping", rest: "leisure",
};
// DB category → itinerary stop kind (for rendering a left-out pick as a stop).
const CAT_TO_KIND: Record<string, Stop["kind"]> = {
  nature: "nature", leisure: "nature", sport: "nature",
  museum: "culture", attraction: "culture", historic: "culture", tourism: "culture",
  food: "food", shopping: "shopping",
};

// Re-time a day's stops sequentially (09:30 start, dwell per stop, transit/walk
// between, one lunch after noon) — the SAME model the builder uses, so after a
// manual drag/insert/remove the clock stays sequential and a freshly-dropped pick
// gets a real time instead of a blank. Client-side + instant (no server round-trip).
const DAY_START_MIN = 9 * 60 + 30, LUNCH_AFTER_MIN = 12 * 60, LUNCH_MIN = 60;
const fmtClock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
// Inverse of geo.durationHe — recover minutes from the Hebrew duration label so an
// existing stop keeps its own dwell; unknown/blank (a bank pick) defaults to 90.
const durToMin = (d?: string): number => {
  if (!d) return 90;
  if (d.includes("חצי שעה")) return 30;
  if (d.includes("45")) return 45;
  if (d.includes("שעתיים וחצי")) return 150;
  if (d.includes("שעה וחצי")) return 90;
  if (d.includes("שעתיים")) return 120;
  const m = d.match(/כ-(\d+)\s*שעות/); if (m) return Number(m[1]) * 60;
  if (d.includes("כשעה")) return 60;
  return 90;
};
function retimeStops(stops: Stop[]): Stop[] {
  const content = stops.filter((s) => s.kind !== "food");
  const out: Stop[] = [];
  let clock = DAY_START_MIN, lunchDone = false;
  content.forEach((s, i) => {
    if (!lunchDone && i > 0 && clock >= LUNCH_AFTER_MIN) {
      out.push({ name: "הפסקת צהריים", kind: "food", time: fmtClock(clock), duration: durationHe(LUNCH_MIN), note: "מסעדה מקומית באזור" });
      clock += LUNCH_MIN; lunchDone = true;
    }
    const dw = durToMin(s.duration);
    out.push({ ...s, time: fmtClock(clock), duration: durationHe(dw) });
    clock += dw;
    const nx = content[i + 1];
    if (nx && s.lat != null && s.lng != null && nx.lat != null && nx.lng != null) {
      clock += travelMinutes(haversineKm(s.lat, s.lng, nx.lat, nx.lng));
    }
  });
  return out;
}

// One-tap AI reshapes for the selected day (shown next to the "why").
const DAY_RESHAPES = [
  { t: "תעשה את היום רגוע ופחות עמוס יותר", l: "קצב רגוע יותר" },
  { t: "צמצם את ההליכה בין המקומות", l: "פחות הליכה" },
  { t: "הוסף עצירת אוכל טובה במיקום שמתאים למסלול", l: "הוסף אוכל" },
];

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
    // same footprint as the photo thumbnail (size-12) so image/icon rows align
    <div className="grid size-12 shrink-0 place-items-center rounded-[12px]"
         style={{ background: meta.soft, color: meta.color }}>
      <Icon size={22} />
    </div>
  );
}

// AI is off for the commercial launch (server kill-switch). Mirror that on the
// client so the "שדרגו עם AI" button only appears when AI can actually run —
// otherwise it just re-runs the same deterministic build. Flip both
// NEXT_PUBLIC_AI_ENABLED (client) and AI_ENABLED (server) to re-enable.
const AI_ENABLED = process.env.NEXT_PUBLIC_AI_ENABLED === "true";

export function TripView({ tripId }: { tripId: string }) {
  const { trips, update, loaded } = useTrips();
  const [globalProfile] = useProfile();
  const { hotels } = useHotels();
  const [busy, setBusy] = useState<null | "generate" | "revise">(null);
  const [error, setError] = useState<string | null>(null);
  // Map day-editing: DB ids of left-out picks marked to ADD, and stops marked to
  // REMOVE, for the day on screen. Committed together via "סדר את היום".
  const [pendAdd, setPendAdd] = useState<Set<number>>(new Set());
  const [pendRemove, setPendRemove] = useState<Set<number>>(new Set());
  // Unified drag (pointer-based → works with mouse AND touch): a stop dragged within
  // the day (kind:"stop") OR a left-out pick dragged in from the bank (kind:"bank").
  // Drop onto a stop row inserts there / reorders; drop onto the bank sends a stop out.
  const [drag, setDrag] = useState<{ kind: "stop"; si: number } | { kind: "bank"; id: number } | null>(null);
  const [dragOverSi, setDragOverSi] = useState<number | null>(null);   // -1 = the end zone
  const [overBank, setOverBank] = useState(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const overRef = useRef<{ type: "stop"; si: number } | { type: "bank" } | { type: "end" } | null>(null);
  const [editTravelers, setEditTravelers] = useState(false);
  const [tool, setTool] = useState<ToolKey | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState(0);                 // one day on screen — pager
  const [mobileTab, setMobileTab] = useState<"plan" | "map">("plan");
  const [datesOpen, setDatesOpen] = useState(false);         // dates aren't permanent — a popover
  const [whyOpen, setWhyOpen] = useState(false);             // AI "why" is on-demand, not a big card
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
  // Day-editing: DB ids marked-remove → their located marker indices (turn red).
  const pendingRemoveLocated = new Set<number>();
  locatedToStop.forEach((si, li) => { const sid = day?.stops[si]?.id; if (sid != null && pendRemove.has(sid)) pendingRemoveLocated.add(li); });
  const pendingCount = pendAdd.size + pendRemove.size;
  // Reset map marks when switching to another day (marks are per-day).
  useEffect(() => { setPendAdd(new Set()); setPendRemove(new Set()); }, [curIdx]);

  // How to get between consecutive located stops: walk vs public transport,
  // decided by the traveler's walk tolerance (walkPref). An honest estimate (not
  // a routed path) — keyed to a stop's index so it renders in the gap below it.
  // Carries the endpoint coords so the row can deep-link to live navigation.
  type LegRow = Leg & { fromLat: number; fromLng: number; toLat: number; toLng: number };
  const walkPref = tripProfile.walkPref ?? DEFAULT_WALK_PREF;
  const legAfter: Record<number, LegRow> = {};
  const dstops = day?.stops ?? [];
  for (let si = 0; si < dstops.length - 1; si++) {
    const a = dstops[si], b = dstops[si + 1];
    if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
    legAfter[si] = { ...estimateLeg(a.lat, a.lng, b.lat, b.lng, walkPref, !!day?.carBase),
      fromLat: a.lat, fromLng: a.lng, toLat: b.lat, toLng: b.lng };
  }
  const legs = Object.values(legAfter);
  const dayTotalKm = legs.reduce((s, l) => s + l.km, 0);
  const dayTotalWalkMin = legs.reduce((s, l) => s + l.walkMin, 0);
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
          taste: deriveTaste(tripProfile), isFamily: tripProfile.kids.length > 0,
          pace: tripProfile.pace, walkPref: tripProfile.walkPref, areaGroups: trip?.areaGroups, ...payload }),
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
      // `leftOut` comes back only on a selection build; keep the last value on
      // revise. `engine` records whether this is the free heuristic or the AI
      // upgrade (no engine field on AI success → "ai").
      update(tripId, { itinerary: data.itinerary, engine: data.engine ?? "ai",
        ...(data.leftOut !== undefined ? { leftOut: data.leftOut } : {}) });
      // deterministic revise couldn't act on a free-text request → surface the hint.
      if (data.note) setError(data.note);
    } catch {
      setError("שגיאת רשת");
    } finally {
      setBusy(null);
    }
  }

  const generate = (ai = false) => call({
    mode: "generate",
    ai,
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

  // ---- Map day-editing: mark adds/removes, then "סדר את היום" rebuilds the day via
  // the deterministic engine (mode:arrange — never AI). ----
  const toggleExtra = (id: number) =>
    setPendAdd((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleRemoveLocated = (li: number) => {
    const sid = day?.stops[locatedToStop[li]]?.id;
    if (sid == null) return;
    setPendRemove((p) => { const n = new Set(p); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });
  };
  const clearPending = () => { setPendAdd(new Set()); setPendRemove(new Set()); };
  async function arrangeDayNow() {
    if (!itinerary || !pendingCount || busy) return;
    setBusy("revise"); setError(null);
    try {
      const res = await fetch("/api/itinerary", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "arrange", city, current: itinerary, dayIndex: curIdx, addIds: [...pendAdd], removeIds: [...pendRemove] }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.itinerary) { setError(data?.error || "אירעה שגיאה"); return; }
      // leftOut: drop the ones we added; add back the stops we removed (so they can be re-added).
      const removedAsLeftOut = (day?.stops ?? []).filter((s) => s.id != null && pendRemove.has(s.id)).map((s) => ({
        id: s.id as number, name_he: s.name, name_en: s.name, lat: s.lat ?? null, lng: s.lng ?? null,
        image_url: s.image ?? null, category: KIND_TO_CAT[s.kind] ?? "attraction", tagline_he: s.tagline ?? null,
      })) as unknown as NonNullable<typeof trip>["leftOut"];
      const newLeftOut = [...(trip?.leftOut ?? []).filter((l) => !pendAdd.has(l.id)), ...(removedAsLeftOut ?? [])];
      update(tripId, { itinerary: data.itinerary, engine: "heuristic", leftOut: newLeftOut });
      clearPending();
    } catch { setError("שגיאת רשת"); } finally { setBusy(null); }
  }
  const arrangeBar = pendingCount > 0 ? (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-[12px] border border-[var(--brand)] bg-[var(--surface)] p-2.5 text-[13px] shadow-[var(--shadow)]">
      <span className="font-medium">
        {pendAdd.size > 0 ? `${pendAdd.size} להוספה` : ""}
        {pendAdd.size > 0 && pendRemove.size > 0 ? " · " : ""}
        {pendRemove.size > 0 ? `${pendRemove.size} להסרה` : ""}
      </span>
      <div className="flex gap-2">
        <button onClick={clearPending} className="rounded-full px-3 py-1.5 text-[12.5px] text-[var(--text-2)] hover:bg-[var(--surface-2)]">בטל</button>
        <button onClick={arrangeDayNow} disabled={!!busy}
          className="rounded-full bg-[var(--brand)] px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50">
          {busy ? "מסדר…" : "סדר את היום"}
        </button>
      </div>
    </div>
  ) : null;

  // Arrived from the city page with ?build=1 → start building immediately, once.
  const autoBuild = useSearchParams().get("build") === "1";
  const autoBuiltRef = useRef(false);
  useEffect(() => {
    if (autoBuild && loaded && trip && !itinerary && canBuild && !busy && !autoBuiltRef.current) {
      autoBuiltRef.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuild, loaded, !!trip, !!itinerary, canBuild, busy]);

  // Re-attach details (photos, coords, taglines) from the DB. Runs for trips
  // built before details/images existed. Guard on IMAGES, not just coords —
  // a trip enriched before its city's photos were ingested has lat/lng but no
  // s.image, and the old "has any lat" check wrongly treated it as done, so the
  // photos never appeared. Attempt once per mount when no stop has an image.
  const detailsTriedRef = useRef(false);
  useEffect(() => { detailsTriedRef.current = false; }, [tripId]);
  useEffect(() => {
    if (!itinerary || !city) return;
    const stops = itinerary.days.flatMap((d) => d.stops);
    if (stops.length === 0) return;
    if (stops.some((s) => s.image)) return;   // already has photos → enriched
    if (detailsTriedRef.current) return;       // already refreshed this mount
    detailsTriedRef.current = true;
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

  // Back-fill coords on left-out picks saved before the map-editing change, so they
  // can show as grey markers. Fires once per mount when any pick lacks lat/lng.
  const leftOutCoordsRef = useRef(false);
  useEffect(() => { leftOutCoordsRef.current = false; }, [tripId]);
  useEffect(() => {
    const lo = trip?.leftOut;
    if (!lo?.length || !city || leftOutCoordsRef.current) return;
    if (lo.every((l) => l.lat != null && l.lng != null)) return;   // already have coords
    leftOutCoordsRef.current = true;
    let cancelled = false;
    fetch("/api/itinerary", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "details", city, current: itinerary ?? { title: "", subtitle: "", days: [] }, leftOut: lo.map((l) => ({ id: l.id })) }) })
      .then((r) => r.json()).catch(() => null)
      .then((d) => { if (!cancelled && d?.leftOut) update(tripId, { leftOut: d.leftOut }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, city, trip?.leftOut?.length]);

  // Left-out markers to show on the map: only picks within a walkable/short-transit
  // reach of the CURRENT day's stops — a far pick (Kew) isn't a sensible add to a
  // central day, so it shouldn't clutter the map for that day.
  const NEAR_KM = 3;
  const nearbyExtras = ((trip?.leftOut ?? []) as unknown as Attraction[]).filter((l) =>
    Number.isFinite(l.lat) && Number.isFinite(l.lng) &&
    mapStops.some((s) => haversineKm(s.lat as number, s.lng as number, l.lat as number, l.lng as number) <= NEAR_KM));

  // --- manual editing: apply a transform to a clone, relabel days, save ---
  function mutate(fn: (it: Itinerary) => void) {
    if (!itinerary) return;
    const it: Itinerary = JSON.parse(JSON.stringify(itinerary));
    fn(it);
    it.days = it.days.filter((d) => d.stops.length > 0);
    it.days.forEach((d, i) => { d.label = `יום ${i + 1}`; });
    update(tripId, { itinerary: it });
  }
  // Move the whole day earlier/later in the trip order (swap with its neighbour),
  // and keep the pager on the day the user is moving.
  const moveDay = (di: number, dir: -1 | 1) => {
    const tgt = di + dir;
    if (tgt < 0 || tgt >= allDays.length) return;
    mutate((it) => { [it.days[di], it.days[tgt]] = [it.days[tgt], it.days[di]]; });
    setDayIdx(tgt);
  };
  // Drag-and-drop: move a stop from index `from` to index `to` within the day,
  // then re-time so the clock stays sequential after the manual reorder.
  const reorderStop = (di: number, from: number, to: number) =>
    mutate((it) => {
      const stops = it.days[di].stops;
      if (from === to || to < 0 || to >= stops.length) return;
      const [m] = stops.splice(from, 1);
      stops.splice(to, 0, m);
      it.days[di].stops = retimeStops(it.days[di].stops);
    });
  const deleteStop = (di: number, si: number) =>
    mutate((it) => { it.days[di].stops.splice(si, 1); it.days[di].stops = retimeStops(it.days[di].stops); });

  // Bank → day: drop a left-out pick into the current day at index `at`, re-time,
  // and remove it from the bank (all in one save).
  const insertBankAt = (di: number, at: number, id: number) => {
    if (!itinerary) return;
    const p = (trip?.leftOut ?? []).find((l) => l.id === id);
    if (!p) return;
    const stop: Stop = {
      name: p.name_he || p.name_en, kind: CAT_TO_KIND[p.category] ?? "culture", time: "", duration: "",
      id: p.id, lat: p.lat ?? undefined, lng: p.lng ?? undefined, image: p.image_url ?? undefined, tagline: p.tagline_he ?? undefined,
    };
    const it: Itinerary = JSON.parse(JSON.stringify(itinerary));
    const stops = it.days[di].stops;
    stops.splice(Math.max(0, Math.min(at, stops.length)), 0, stop);
    it.days[di].stops = retimeStops(stops);
    it.days = it.days.filter((d) => d.stops.length > 0);
    it.days.forEach((d, i) => { d.label = `יום ${i + 1}`; });
    update(tripId, { itinerary: it, leftOut: (trip?.leftOut ?? []).filter((l) => l.id !== id) });
  };
  // Day → bank: drop a stop onto the bank — remove it from the day, re-time, and
  // add it to the left-out list so it can be dragged back into any day.
  const moveStopToBank = (di: number, si: number) => {
    if (!itinerary) return;
    const s = itinerary.days[di].stops[si];
    if (!s) return;
    const it: Itinerary = JSON.parse(JSON.stringify(itinerary));
    it.days[di].stops.splice(si, 1);
    it.days[di].stops = retimeStops(it.days[di].stops);
    it.days = it.days.filter((d) => d.stops.length > 0);
    it.days.forEach((d, i) => { d.label = `יום ${i + 1}`; });
    // food/lunch rows have no id — just drop them (re-time re-adds lunch anyway).
    const patch: Parameters<typeof update>[1] = { itinerary: it };
    if (s.id != null && !(trip?.leftOut ?? []).some((l) => l.id === s.id)) {
      const entry = { id: s.id, name_he: s.name, name_en: s.name, lat: s.lat ?? null, lng: s.lng ?? null,
        image_url: s.image ?? null, category: KIND_TO_CAT[s.kind] ?? "attraction", tagline_he: s.tagline ?? null };
      patch.leftOut = [entry as NonNullable<NonNullable<typeof trip>["leftOut"]>[number], ...(trip?.leftOut ?? [])];
    }
    update(tripId, patch);
  };

  // Pointer-drag manager (mouse + touch): start on a grip, follow the finger with a
  // floating ghost, hit-test drop targets by their data-attrs, and on release route
  // to reorder / insert-from-bank / move-to-bank. Replaces HTML5 DnD so it works on
  // touch screens too. dragRef/overRef hold the live values the move/up handlers read.
  const startPointerDrag = (
    e: React.PointerEvent, item: NonNullable<typeof drag>, label: string
  ) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    dragRef.current = item; overRef.current = null;
    setDrag(item); setGhost({ x: e.clientX, y: e.clientY, label });
    const dayLen = day?.stops.length ?? 0;
    let lastX = e.clientX, lastY = e.clientY, raf = 0;
    // Resolve the drop target under (x,y). Shared by pointermove AND the autoscroll
    // loop, so the target keeps updating while the page scrolls under a still finger.
    const updateOver = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const endEl = el?.closest("[data-drop-end]");
      const stopEl = el?.closest("[data-drop-idx]");
      const bankEl = el?.closest("[data-drop-bank]");
      if (endEl) { overRef.current = { type: "end" }; setDragOverSi(-1); setOverBank(false); }
      else if (stopEl) { const si = Number(stopEl.getAttribute("data-drop-idx")); overRef.current = { type: "stop", si }; setDragOverSi(si); setOverBank(false); }
      else if (bankEl && dragRef.current?.kind === "stop") { overRef.current = { type: "bank" }; setOverBank(true); setDragOverSi(null); }
      else { overRef.current = null; setDragOverSi(null); setOverBank(false); }
    };
    // Continuous edge autoscroll — runs every frame while the finger sits near the
    // top/bottom, so a card from the bottom bank can reach a day higher up.
    const tick = () => {
      const M = 90;
      let dy = 0;
      if (lastY < M) dy = -Math.ceil((M - lastY) / 5);
      else if (lastY > window.innerHeight - M) dy = Math.ceil((lastY - (window.innerHeight - M)) / 5);
      if (dy) { window.scrollBy(0, dy); updateOver(lastX, lastY); }
      raf = requestAnimationFrame(tick);
    };
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      lastX = ev.clientX; lastY = ev.clientY;
      setGhost((g) => (g ? { ...g, x: ev.clientX, y: ev.clientY } : g));
      updateOver(ev.clientX, ev.clientY);
    };
    const onUp = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const d = dragRef.current, over = overRef.current;
      if (d && over) {
        if (d.kind === "stop") {
          if (over.type === "bank") moveStopToBank(curIdx, d.si);
          else if (over.type === "end") reorderStop(curIdx, d.si, dayLen - 1);
          else if (over.type === "stop" && over.si !== d.si) reorderStop(curIdx, d.si, over.si);
        } else {
          if (over.type === "stop") insertBankAt(curIdx, over.si, d.id);
          else if (over.type === "end") insertBankAt(curIdx, dayLen, d.id);
        }
      }
      dragRef.current = null; overRef.current = null;
      setDrag(null); setGhost(null); setDragOverSi(null); setOverBank(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    raf = requestAnimationFrame(tick);
  };

  // compact date range for the thin top row (no permanent inputs)
  const fmtD = (iso?: string) => { if (!iso) return null; const p = iso.split("-"); return `${+p[2]}.${+p[1]}`; };
  const dateRangeText = trip?.startDate && trip?.endDate
    ? `${fmtD(trip.startDate)}–${fmtD(trip.endDate)}`
    : (fmtD(trip?.startDate) ?? null);

  if (loaded && !trip) {
    return (
      <main className="mx-auto max-w-[440px] px-5 pt-16 text-center">
        <p className="serif text-[22px]">הטיול לא נמצא</p>
        <Link href="/trips" className="mt-3 inline-block text-[15px] text-[var(--accent-ink)]">← לכל הטיולים</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[440px] pb-16 lg:max-w-[1600px]">
      {/* THREE THIN ROWS — the map + itinerary are the hero and fill the first
          viewport, so trip info / day tabs / day summary are compressed to slim
          horizontal strips (no big card, no poster, no permanent date inputs). */}
      {/* the three thin rows sit to the LEFT of a compact destination image
          (same 160×105 landscape treatment as the city page). The image is
          absolute so it spans the rows without adding any header height; the
          rows reserve room on the right (lg:pr) so nothing runs under it. */}
      <div className="lg:relative">
        {trip?.destinationId && (
          <div className="hidden overflow-hidden rounded-[var(--radius-sm)] lg:absolute lg:top-3 lg:block lg:h-[105px] lg:w-[160px]"
               style={{ insetInlineStart: "32px" }}>
            <CityPoster destinationId={trip.destinationId} cityHe={cityHe}
              orientation="landscape" position="50% 45%" className="absolute inset-0 size-full" />
          </div>
        )}
      {/* row 1 — trip info + actions */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-5 pt-2 lg:pl-8 lg:pr-[204px] lg:pt-3">
        <Link href="/trips" className="eyebrow inline-flex items-center gap-1 text-[var(--text-2)]">
          <ChevronRight size={14} /> הטיולים שלי
        </Link>
        <span className="hidden h-3.5 w-px bg-[var(--border)] sm:block" />
        <h1 className="serif text-[17px] font-bold leading-tight lg:text-[19px]">{trip?.title ?? "…"}</h1>
        {(cityHe || (trip?.segments && trip.segments.length > 1)) && (
          <span className="text-[13px] text-[var(--text-2)]">
            {trip?.segments && trip.segments.length > 1
              ? trip.segments.map((s) => s.cityHe || s.city).join(" → ")
              : cityHe}
            {trip?.days ? ` · ${trip.days} ימים` : ""}
            {trip?.month ? ` · ${MONTHS_HE[trip.month - 1]}` : ""}
          </span>
        )}
        {/* dates — a compact chip that opens a small editor, not permanent inputs */}
        <div className="relative">
          <button onClick={() => setDatesOpen((o) => !o)}
            className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[12.5px] text-[var(--text-2)] transition hover:border-[var(--brand)]">
            <CalendarDays size={13} /> {dateRangeText ?? "תאריכים"}
          </button>
          {datesOpen && (
            <>
              <div className="fixed inset-0 z-[40]" onClick={() => setDatesOpen(false)} />
              <div className="absolute right-0 top-full z-[41] mt-1 flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow)]">
                <input type="date" value={trip?.startDate ?? ""} aria-label="תאריך התחלה"
                  onChange={(e) => { const info = datesToInfo(e.target.value, trip?.endDate);
                    update(tripId, { startDate: e.target.value || undefined, ...(info ? { days: info.days, month: info.month } : {}) }); }}
                  className="w-[150px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[13px] text-[var(--text)] outline-none" />
                <input type="date" value={trip?.endDate ?? ""} min={trip?.startDate} aria-label="תאריך סיום"
                  onChange={(e) => { const info = datesToInfo(trip?.startDate, e.target.value);
                    update(tripId, { endDate: e.target.value || undefined, ...(info ? { days: info.days, month: info.month } : {}) }); }}
                  className="w-[150px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[13px] text-[var(--text)] outline-none" />
              </div>
            </>
          )}
        </div>
        {/* actions pushed to the far side */}
        <div className="flex items-center gap-2 lg:mr-auto">
          <button onClick={() => generate(false)} disabled={!!busy || !canBuild}
            className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-3.5 py-1.5 text-[13.5px] font-medium text-white disabled:opacity-50">
            {busy === "generate" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {busy === "generate" ? "בונה…" : itinerary ? "בנה מחדש" : "בנה לו\"ז"}
          </button>
          {/* AI upgrade — hidden unless AI is explicitly enabled. With the kill-switch
              off (default) it would just re-run the same deterministic build, so
              showing it is misleading. Flip NEXT_PUBLIC_AI_ENABLED=true to re-enable. */}
          {AI_ENABLED && itinerary && trip?.engine !== "ai" && (
            <button onClick={() => generate(true)} disabled={!!busy} title="תכנון חכם יותר עם AI — סידור, נרטיב ותובנות מטיילים"
              className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--accent)] bg-[var(--accent-soft)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--accent-ink)] disabled:opacity-50">
              <Sparkles size={14} /> שדרגו עם AI
            </button>
          )}
          <button onClick={() => setEditTravelers((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--brand)] px-3 py-1.5 text-[13.5px] font-medium"
            style={{ background: editTravelers ? "var(--brand-soft)" : "var(--surface)", color: "var(--brand-ink)" }}>
            <Users size={14} /> מי נוסע
          </button>
          {trip && (
            <ShareTrip trip={trip} profile={tripProfile}
              onShared={(shared) => update(tripId, { shared })} />
          )}
          {trip && <EditorTools trip={trip} itinerary={itinerary} />}
        </div>
      </div>

      {/* row 2 — day tabs (thin pills) */}
      {itinerary && allDays.length > 0 && (
        <div className="mt-1.5 flex items-center gap-2.5 px-5 lg:pl-8 lg:pr-[204px]">
          <span className="hidden shrink-0 text-[12px] font-semibold text-[var(--text-3)] sm:block">ימי הטיול</span>
          <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "none" }}>
            {allDays.map((d, i) => {
              const on = i === curIdx;
              const today = i === todayIndex;
              return (
                <button key={i} onClick={() => { setDayIdx(i); setExpanded(null); setActive(null); }}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-[13px] font-medium transition"
                  style={{ background: on ? "var(--brand)" : "var(--surface)",
                           color: on ? "#fff" : "var(--text-2)",
                           borderColor: on ? "var(--brand)" : today ? "var(--accent)" : "var(--border)" }}>
                  {today ? "היום" : `יום ${i + 1}`}
                  <span className="rounded-full px-1.5 text-[11px] tabular-nums"
                    style={{ background: on ? "rgba(255,255,255,.22)" : "var(--surface-2)", color: on ? "#fff" : "var(--text-3)" }}>
                    {d.stops.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* remixed-trip loop: this trip was copied from a community share, so nudge
          the visitor to make it theirs and share a fresh link BACK to the asker */}
      {trip?.remixOf && (
        <div className="px-5 pt-4 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-sm)] border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-4 py-2.5 text-[13px] text-[var(--brand-ink)]">
            <span className="flex items-center gap-1.5"><Copy size={14} /> העתק שלכם לעריכה — המקור לא נגע.</span>
            <span className="text-[var(--text-2)]">שיפרתם? שתפו קישור חדש בחזרה בקבוצה 👈</span>
            <Link href={`/t/${trip.remixOf}`} className="mr-auto text-[12.5px] font-medium underline underline-offset-2">
              לטיול המקורי
            </Link>
          </div>
        </div>
      )}

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

      {/* row 3 — day summary (thin strip, no card): day label + edit + stats,
          and an on-demand "why?" toggle (no big AI explanation block) */}
      {itinerary && day && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-5 pb-2 lg:pl-8 lg:pr-[204px]">
          <h2 className="serif text-[15px] font-bold leading-tight lg:text-[16px]">{dayLabels[curIdx]}</h2>
          {/* move the whole day earlier / later in the trip order. RTL: right
              arrow = earlier day (toward יום 1), left arrow = later. */}
          {allDays.length > 1 && (
            <span className="flex items-center gap-0.5" title="הזזת היום בסדר הימים">
              <button onClick={() => moveDay(curIdx, -1)} disabled={curIdx === 0} aria-label="הקדם את היום"
                className="grid size-6 place-items-center rounded-md border border-[var(--border)] text-[var(--text-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-ink)] disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
              <button onClick={() => moveDay(curIdx, 1)} disabled={curIdx === allDays.length - 1} aria-label="אחר את היום"
                className="grid size-6 place-items-center rounded-md border border-[var(--border)] text-[var(--text-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-ink)] disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
            </span>
          )}
          {day.dayTrip ? (
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--amber-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--text)]">
              <Car size={13} /> יום טיול ברכב · {day.dayTrip.driveKm} ק״מ · ~{day.dayTrip.driveMin} דק׳ נסיעה
              {day.dayTrip.anchorLat != null && day.dayTrip.anchorLng != null && (
                <a href={googleMapsUrl(day.dayTrip.anchorLat, day.dayTrip.anchorLng)} target="_blank" rel="noreferrer"
                  className="flex items-center gap-0.5 text-[var(--brand-ink)] underline-offset-2 hover:underline">
                  <Navigation size={11} /> נווט
                </a>
              )}
            </span>
          ) : day.area && (
            <span className="flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[12px] font-medium text-[var(--brand-ink)]">
              <MapPin size={11} /> {day.area}
            </span>
          )}
          <span className="hidden h-3.5 w-px bg-[var(--border)] sm:block" />
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-[var(--text-2)]">
            {dayTotalKm > 0 && <span className="flex items-center gap-1"><Ruler size={12} className="text-[var(--text-3)]" /> {formatDistance(dayTotalKm)}</span>}
            {!day.dayTrip && dayTotalWalkMin > 0 && <span className="flex items-center gap-1"><Footprints size={12} className="text-[var(--text-3)]" /> ~{dayTotalWalkMin} דק׳ הליכה</span>}
            {dayStart && dayEnd && <span className="flex items-center gap-1" dir="ltr"><Clock size={12} className="text-[var(--text-3)]" /> {dayStart}–{dayEnd}</span>}
            {day.base && <span className="flex items-center gap-1"><Navigation size={12} className="text-[var(--text-3)]" /> {day.base}</span>}
          </div>
          {day.why && (
            <button onClick={() => setWhyOpen((o) => !o)}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-soft)] lg:mr-auto">
              <Lightbulb size={13} className="text-[var(--accent)]" /> למה בנינו את היום?
              <ChevronDown size={13} className={`transition-transform ${whyOpen ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}
      </div>{/* /lg:relative header wrapper (rows + destination image) */}

      {/* on-demand "why" — a slim expandable strip, not a permanent block */}
      {itinerary && day?.why && whyOpen && (
        <div className="px-5 pt-2 lg:px-8">
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <p className="text-[13px] leading-snug text-[var(--text-2)]">{day.why}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DAY_RESHAPES.map((q) => (
                <button key={q.l} disabled={!!busy}
                  onClick={() => revise(`שנה אך ורק את ${dayLabels[curIdx]} (היום ה-${curIdx + 1} בטיול), אל תיגע בשאר הימים. ${q.t}`)}
                  className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--text-2)] transition hover:border-[var(--brand)] disabled:opacity-50">
                  <Sparkles size={11} className="text-[var(--brand)]" /> {q.l}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="lg:flex lg:items-start lg:gap-4 lg:px-8 lg:pt-2.5">
        {/* main column (right on desktop): the day timeline */}
        <div className="lg:min-w-0 lg:flex-1">
      {error && error.trim() && (
        <div className="mx-5 mt-4 rounded-[var(--radius-card)] bg-[var(--amber-soft)] px-4 py-3 text-[14px] text-[var(--amber)] lg:mx-0">
          {error}
        </div>
      )}

      {/* pre-build state — everything's ready but the itinerary isn't built yet
          (e.g. arriving from "new trip · by hotel"). A clear CTA instead of a
          confusing blank page. */}
      {!itinerary && !busy && canBuild && !multiTrip && (
        <div className="mx-5 mt-5 flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-[var(--brand)] bg-[var(--surface)] px-5 py-10 text-center shadow-[var(--shadow)] lg:mx-0">
          <div className="grid size-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)]"><Sparkles size={22} /></div>
          <p className="serif mt-3 text-[19px] font-semibold">הכול מוכן — נבנה את הלו״ז</p>
          <p className="mt-1 max-w-sm text-[14px] leading-snug text-[var(--text-2)]">
            {tripHotels.length
              ? <>נרכיב {trip?.days} ימים סביב {tripHotels[0].name} — כל יום מקובץ לפי קרבה, עם זמני הליכה/תחבורה וניווט.</>
              : <>נרכיב {trip?.days} ימים ב{cityHe} — מקובץ לפי קרבה, עם זמני הליכה/תחבורה וניווט.</>}
          </p>
          <button onClick={() => generate(false)} disabled={!!busy}
            className="mt-5 flex items-center gap-2 rounded-full bg-[var(--brand)] px-7 py-3 text-[16px] font-semibold text-white shadow-[0_6px_16px_rgba(14,107,94,.3)] disabled:opacity-60">
            <Sparkles size={18} /> בנו לי לו״ז
          </button>
          <p className="mt-2 text-[12px] text-[var(--text-3)]">מיידי וחינם · אפשר לשדרג עם AI אחרי הבנייה</p>
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
                extras={nearbyExtras} pendingAddIds={pendAdd} pendingRemoveLocated={pendingRemoveLocated}
                onToggleExtra={toggleExtra} onToggleRemove={toggleRemoveLocated}
                onStopClick={(li) => { const si = locatedToStop[li]; if (si == null) return;
                  setExpanded(`${curIdx}-${si}`); setActive(li); setMobileTab("plan"); }} />
              {arrangeBar}
            </div>
          )}

          {/* the day as a timeline — photo · stop · numbered spine · time.
              Flat bordered panel (not a floating shadow card) so it pairs with
              the map as one continuous workspace */}
          <div className={mobileTab === "map" ? "hidden lg:block" : ""}>
            <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 lg:mt-0 lg:px-4">
              {day.gateway && (
                <div className="flex items-start gap-2 border-b border-[var(--border)] py-2.5 text-[12.5px] leading-snug text-[var(--text-2)]">
                  <span aria-hidden className="mt-px">🚉</span>
                  <span><b className="text-[var(--text)]">איך מגיעים לאזור:</b> {day.gateway}</span>
                </div>
              )}
              {day.stops.map((s, si) => {
                const key = `${curIdx}-${si}`;
                const isOpen = expanded === key;
                const hasDetails = !!(
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
                  <div key={si} ref={(el) => { stopRefs.current[si] = el; }}
                       data-drop-idx={si}
                       className={drag?.kind === "stop" && drag.si === si ? "opacity-40" : ""}
                       style={dragOverSi === si && drag && !(drag.kind === "stop" && drag.si === si)
                         ? { boxShadow: `inset 0 ${drag.kind === "bank" || (drag.kind === "stop" && drag.si > si) ? 3 : -3}px 0 0 var(--brand)` } : undefined}>
                    <div className={`group/row -mx-2 flex gap-3 rounded-[12px] px-2 transition-colors ${hasDetails ? "cursor-pointer" : ""}`}
                         style={{ background: isActive ? `color-mix(in srgb, ${col} 12%, transparent)` : "transparent" }}
                         onMouseEnter={() => ci != null && setActive(ci)}
                         onMouseLeave={() => setActive(null)}
                         onClick={() => hasDetails && setExpanded(isOpen ? null : key)}>
                      {/* leading controls — both appear on row hover, side by side with a
                          gap between them: grip to drag-reorder, and a quick delete (the
                          gap keeps the destructive action from being an easy misclick).
                          Hidden on the auto lunch row (it's re-timed, not user-managed). */}
                      <div className={`flex items-center gap-2 opacity-0 transition-opacity group-hover/row:opacity-100 ${s.kind === "food" ? "invisible" : ""}`}>
                        <span
                          onPointerDown={(e) => startPointerDrag(e, { kind: "stop", si }, s.name)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ touchAction: "none" }}
                          className="grid size-6 cursor-grab touch-none place-items-center text-[var(--text-3)] active:cursor-grabbing" title="גררו לשינוי סדר · או אל 'לא נכנסו' כדי להוציא">
                          <GripVertical size={16} />
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteStop(curIdx, si); }}
                          title="מחק עצירה" aria-label="מחק עצירה"
                          className="grid size-6 place-items-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger,#dc2626)]">
                          <Trash2 size={15} />
                        </button>
                      </div>
                      {/* photo (falls back to the kind icon) */}
                      <div className="py-2.5 pr-1">
                        {s.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.image} alt="" loading="lazy"
                            className="size-12 rounded-[12px] object-cover" />
                        ) : (
                          <StopIcon kind={s.kind} />
                        )}
                      </div>
                      {/* name + details */}
                      <div className="min-w-0 flex-1 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="line-clamp-2 text-[16px] font-medium leading-tight">{s.name}</p>
                            {fromSelection && s.anchor === true && (
                              <span className="shrink-0 rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--brand-ink)]">עוגן</span>
                            )}
                            {fromSelection && s.anchor === false && (
                              <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-3)]">אם יש זמן</span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {/* recommended stay at the place — labelled so it isn't
                                mistaken for arrival/travel time */}
                            {s.duration && (
                              <span className="flex items-center gap-1 text-[12.5px] text-[var(--text-3)]" title="משך שהייה מומלץ במקום">
                                <Hourglass size={11} className="shrink-0" /> {stayHe(s.duration)}
                              </span>
                            )}
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
                        {s.note && <p className={`mt-1 text-[13.5px] leading-snug text-[var(--text-2)] ${isOpen ? "" : "line-clamp-2"}`}>{s.note}</p>}
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
                      <div className="w-11 shrink-0 py-2.5">
                        <p className="text-[14px] font-semibold text-[var(--text-2)]" dir="ltr">{s.time}</p>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-[var(--border)] pb-3.5 pt-3">
                        {s.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          // capped banner — never upscale past the ~640px source; a
                          // full-width 4:3 was a huge block on the wide desktop column
                          <img src={bigImage(s.image)} alt="" loading="lazy"
                            onError={(e) => { const t = e.currentTarget; if (s.image && t.src !== s.image) t.src = s.image; }}
                            className="mb-3 h-[220px] w-full max-w-[480px] rounded-[10px] object-cover" />
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

                    {/* how to get to the next stop — walk vs transit by the
                        traveler's tolerance, with a live-navigation deep-link */}
                    {leg && !last && (
                      <div className="flex items-stretch gap-3">
                        <div className="w-12 shrink-0 pr-1" />
                        <div className="min-w-0 flex-1 py-0.5">
                          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-[var(--text-3)]">
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <span aria-hidden>{leg.icon}</span>
                              <span className="text-[var(--text-2)]">{leg.primaryHe}</span>
                            </span>
                            <span className="whitespace-nowrap">· {formatDistance(leg.km)}</span>
                            {leg.altHe && <span className="whitespace-nowrap">{leg.altHe}</span>}
                            <a href={googleDirUrl(leg.fromLat, leg.fromLng, leg.toLat, leg.toLng,
                                 leg.recommended === "transit" ? "transit" : leg.recommended === "drive" ? "driving" : "walking")}
                              target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 whitespace-nowrap text-[var(--brand-ink)] underline decoration-dotted underline-offset-2">
                              <MapPin size={11} /> נווט
                            </a>
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
              {/* drop-at-end zone — only while dragging a left-out pick, to place it
                  as the day's last stop. */}
              {drag?.kind === "bank" && (
                <div data-drop-end
                  className="mx-2 my-1 rounded-[10px] border-2 border-dashed py-3 text-center text-[12.5px] transition-colors"
                  style={{ borderColor: dragOverSi === -1 ? "var(--brand)" : "var(--border)",
                           background: dragOverSi === -1 ? "var(--brand-soft)" : "transparent",
                           color: dragOverSi === -1 ? "var(--brand-ink)" : "var(--text-3)" }}>
                  שחררו כאן כדי להוסיף בסוף היום
                </div>
              )}
            </div>

            {/* why this day is shaped this way — mobile only (desktop shows it in
                the header). AI insight + quick reshapes */}
            {/* the "why" now lives in the thin day-summary row (on-demand toggle,
                all sizes) — no separate block here */}
          </div>

          {/* picks that didn't fit the days — a drag "bank". Drag a card up into any
              day at the exact spot you want; drag a stop DOWN onto this box to send
              it back here. Shown when it has picks OR while a stop is being dragged
              (so there's always somewhere to drop a stop you want to remove). */}
          {((trip?.leftOut?.length ?? 0) > 0 || drag?.kind === "stop") && (
            <div data-drop-bank
              className="mt-3 rounded-[var(--radius-card)] border bg-[var(--amber-soft)] p-4 transition-colors"
              style={{ borderColor: overBank ? "var(--brand)" : "var(--amber)",
                       boxShadow: overBank ? "inset 0 0 0 2px var(--brand)" : "none" }}>
              <p className="text-[14px] font-semibold text-[var(--amber)]">לא נכנסו ליומן · {trip?.leftOut?.length ?? 0}</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--text-2)]">
                {drag?.kind === "stop"
                  ? "שחררו כאן כדי להוציא את העצירה מהיומן."
                  : "גררו כרטיס למעלה אל היום — למקום המדויק שתרצו. כדי להוציא עצירה, גררו אותה לכאן."}
              </p>
              <div className="mt-3 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
                {(trip?.leftOut ?? []).map((p) => (
                  <div key={p.id}
                    onPointerDown={(e) => startPointerDrag(e, { kind: "bank", id: p.id }, p.name_he || p.name_en)}
                    style={{ touchAction: "none" }}
                    className={`flex cursor-grab touch-none items-center gap-3 rounded-[10px] bg-[var(--surface)] p-2 shadow-[var(--shadow)] active:cursor-grabbing ${drag?.kind === "bank" && drag.id === p.id ? "opacity-40" : ""}`}>
                    <span className="grid size-6 shrink-0 place-items-center text-[var(--text-3)]" title="גררו אל היום"><GripVertical size={16} /></span>
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url} alt="" loading="lazy" className="size-11 shrink-0 rounded-[8px] object-cover" />
                    ) : (
                      <div className="grid size-11 shrink-0 place-items-center rounded-[8px] bg-[var(--surface-2)] text-[var(--text-3)]"><MapPin size={16} /></div>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{p.name_he || p.name_en}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                <div className="h-[calc(100dvh-265px)] max-h-[700px] min-h-[440px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
                  <MapClient attractions={stopPoints} center={mapCenter} selected={null} ordered
                    hotels={hotelPoints} focus={focus} colors={stopColors} activeIdx={active}
                extras={nearbyExtras} pendingAddIds={pendAdd} pendingRemoveLocated={pendingRemoveLocated}
                onToggleExtra={toggleExtra} onToggleRemove={toggleRemoveLocated}
                    onStopClick={(li) => { const si = locatedToStop[li]; if (si == null) return;
                      setExpanded(`${curIdx}-${si}`); setActive(li);
                      requestAnimationFrame(() => stopRefs.current[si]?.scrollIntoView({ behavior: "smooth", block: "center" })); }} />
                </div>
                {arrangeBar}

                {/* legend — a collapsible floating card tying numbers to names. Hidden
                    while editing on the map (pending marks) so it can't cover markers. */}
                {stopPoints.length > 0 && pendingCount === 0 && (
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

      {/* floating drag ghost — follows the finger/cursor during a pointer drag so
          touch users get the same "picked up" feedback native DnD gives the mouse. */}
      {ghost && (
        <div className="pointer-events-none fixed z-[100] max-w-[220px] truncate rounded-full border border-[var(--brand)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium shadow-[var(--shadow)]"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
          {ghost.label}
        </div>
      )}
    </main>
  );
}
