"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight, ChevronLeft, Mountain, Utensils, Landmark, Coffee, ShoppingBag,
  Sparkles, Star, Loader2, ChevronDown,
  Trash2, ExternalLink, Navigation, Map as MapIcon, Route, Luggage, ListChecks, Wallet, CalendarDays,
  Clock, MapPin, Ruler, Footprints, Copy, Car, Hourglass, GripVertical, Plus, Minus, Search, X,
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
import { googleMapsUrl, googleMapsPin, googleMapsNearby, googleDirUrl, formatDistance, estimateLeg, haversineKm, travelMinutes, durationHe, round30, DEFAULT_WALK_PREF, type Leg } from "@/lib/geo";
import { stopColor } from "@/lib/labels";
import { entryExit, type LatLng } from "@/lib/access";
import { orderFromDepot } from "@/lib/cluster";
import { bigImage, catLabel, catColor } from "@/lib/labels";
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
import { stopEntryPerPerson } from "@/lib/budget";
import { Hotels } from "@/app/trips/Hotels";
import { EditorTools } from "./EditorTools";
import { MapClient } from "@/components/MapClient";

const KIND_TO_CAT: Record<string, string> = {
  nature: "nature", food: "food", culture: "museum", shopping: "shopping", rest: "leisure",
};
// DB category → itinerary stop kind (for rendering a left-out pick as a stop).
const CAT_TO_KIND: Record<string, Stop["kind"]> = {
  nature: "nature", leisure: "nature", sport: "nature",
  museum: "culture", attraction: "culture", historic: "culture", tourism: "culture",
  food: "food", shopping: "shopping",
  // traveller-added place types (see MANUAL_TYPES) → a stop kind for icon/colour
  bar: "food", cafe: "rest", fun: "culture", other: "culture",
};

// Type tags for a traveller-added place. The `key` is stored as the item's category
// (so CAT_TO_KIND gives it an icon/colour); `he` is the pill label shown on the card.
const MANUAL_TYPES: { key: string; he: string; emoji: string }[] = [
  { key: "food", he: "מסעדה", emoji: "🍴" },
  { key: "bar", he: "בר / חיי לילה", emoji: "🍸" },
  { key: "cafe", he: "בית קפה", emoji: "☕" },
  { key: "fun", he: "קזינו / בידור", emoji: "🎰" },
  { key: "other", he: "אחר", emoji: "📍" },
];
const manualTypeLabel = (key: string) => MANUAL_TYPES.find((t) => t.key === key) ?? MANUAL_TYPES[4];

// Re-time a day's stops sequentially (09:30 start, dwell per stop, transit/walk
// between, one lunch after noon) — the SAME model the builder uses, so after a
// manual drag/insert/remove the clock stays sequential and a freshly-dropped pick
// gets a real time instead of a blank. Client-side + instant (no server round-trip).
const DAY_START_MIN = 9 * 60 + 30, LUNCH_AFTER_MIN = 12 * 60, LUNCH_MIN = 60;
const fmtClock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
// A saved-trip timestamp (ms) → short Hebrew date + time, e.g. "23.7.26, 14:05".
const fmtStamp = (ms?: number) => (ms ? new Date(ms).toLocaleString("he-IL", { day: "numeric", month: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
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
  // If the day already has a meal break, treat it as a REAL, user-placed stop: keep
  // it wherever it sits in the order (so a stop dragged above/below it stays there)
  // and just recompute times. Only a day with NO meal gets one auto-inserted at noon.
  // Every break (food/rest) keeps its OWN duration (dinner 90, rest 60, edited stays);
  // arrival times snap to the nearest half hour so the day reads as clean :00/:30 slots.
  const hasFood = stops.some((s) => s.kind === "food");
  const seq = hasFood ? stops : stops.filter((s) => s.kind !== "food");
  // Resolve each coord-bearing stop's ENTER/EXIT ports so a dragged street is timed
  // end-to-end: you enter the end nearer the previous stop, walk it (dwell), and the
  // leg to the next stop starts from the far end — same contract the builder + map
  // use (lib/access), not the street's midpoint. Point stops → enter = exit = coord.
  const coord = seq.filter((s) => s.lat != null && s.lng != null);
  const port = new Map<Stop, { enter: LatLng; exit: LatLng }>();
  let prevExit: LatLng | null = null;
  coord.forEach((s, i) => {
    const a = s.path && s.path.length > 1
      ? { ends: [s.path[0], s.path[s.path.length - 1]] as [LatLng, LatLng], lat: s.lat, lng: s.lng }
      : { lat: s.lat, lng: s.lng };
    const nx = coord[i + 1];
    const to: LatLng | null = nx
      ? (nx.path && nx.path.length ? (nx.path[0] as LatLng) : [nx.lat as number, nx.lng as number])
      : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { enter, exit } = entryExit(a as any, prevExit, to);
    port.set(s, { enter, exit });
    prevExit = exit;
  });
  const out: Stop[] = [];
  let clock = round30(DAY_START_MIN), lunchDone = hasFood;
  seq.forEach((s, i) => {
    if (!lunchDone && i > 0 && clock >= LUNCH_AFTER_MIN) {
      const t = round30(clock);
      out.push({ name: "הפסקת צהריים", kind: "food", time: fmtClock(t), duration: durationHe(LUNCH_MIN), note: "מסעדה מקומית באזור" });
      clock = t + LUNCH_MIN; lunchDone = true;
    }
    const dw = durToMin(s.duration);   // honours edited / added-break durations
    const arr = round30(clock);
    out.push({ ...s, time: fmtClock(arr), duration: durationHe(dw) });
    clock = arr + dw;
    // travel from THIS stop's exit port to the next COORD-bearing stop's enter port
    const nx = seq.slice(i + 1).find((x) => x.lat != null && x.lng != null);
    if (nx && s.lat != null && s.lng != null) {
      const from = port.get(s)?.exit ?? [s.lat, s.lng as number];
      const dest = port.get(nx)?.enter ?? [nx.lat as number, nx.lng as number];
      clock += travelMinutes(haversineKm(from[0], from[1], dest[0], dest[1]));
    }
  });
  return out;
}

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

export function TripView({ tripId, editorial = false }: { tripId: string; editorial?: boolean }) {
  const { trips, update, remove, loaded } = useTrips();
  const [globalProfile] = useProfile();
  const { hotels } = useHotels();
  const [busy, setBusy] = useState<null | "generate" | "revise">(null);
  const [error, setError] = useState<string | null>(null);
  // Unified drag (pointer-based → works with mouse AND touch): a stop dragged within
  // the day (kind:"stop") OR a left-out pick dragged in from the bank (kind:"bank").
  // Drop onto a stop row inserts there / reorders; drop onto the bank sends a stop out.
  const [drag, setDrag] = useState<{ kind: "stop"; si: number } | { kind: "bank"; id: number } | null>(null);
  const [dragOverSi, setDragOverSi] = useState<number | null>(null);   // -1 = the end zone
  const [overBank, setOverBank] = useState(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const overRef = useRef<{ type: "stop"; si: number } | { type: "bank" } | { type: "end" } | null>(null);
  // Per-trip travelers editor is opened only for a locationless trip now (the "מי נוסע"
  // button was removed), so this is a plain constant rather than toggleable state.
  const editTravelers = false;
  const [tool, setTool] = useState<ToolKey | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState(0);                 // one day on screen — pager
  const [mobileTab, setMobileTab] = useState<"plan" | "map">("plan");
  const [datesOpen, setDatesOpen] = useState(false);         // dates aren't permanent — a popover
  const [focus, setFocus] = useState<{ lat: number; lng: number; n: number; keepZoom?: boolean } | null>(null);
  // A bank ("לא נכנסו") card the user is pointing at — highlight its marker on the map,
  // exactly like hovering a scheduled stop lights up its pin.
  const [hoverBankId, setHoverBankId] = useState<number | null>(null);
  // "Add any place" search over the whole city (the bank is only the ranked leftOut set;
  // this lets a traveller add a specific place they remembered — no rebuild).
  type SearchHit = { id: number; name_he: string | null; name_en: string; category: string;
    lat: number | null; lng: number | null; image_url: string | null; tagline_he: string | null;
    tips_he: string | null; description_he: string | null; must_see: number | null };
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  // "Add a place I was told about" — a manual entry (typed or pasted from a Google-Maps
  // link) that becomes a draggable item in the "מקומות שהוספתי" bank section.
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addLink, setAddLink] = useState("");
  const [addType, setAddType] = useState("food");
  const [addAddress, setAddAddress] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addCoords, setAddCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [addFlash, setAddFlash] = useState(false);   // one-shot green flash on the address field
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
    ...(s.path ? { path: s.path } : {}),
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
          pace: tripProfile.pace, walkPref: tripProfile.walkPref, areaGroups: trip?.areaGroups, areaIds: trip?.areaIds, ...payload }),
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
        // keep the "X ימים" label in sync with what was actually built (a
        // neighbourhood build sets its own day count = areas + extra days).
        ...(data.itinerary?.days?.length ? { days: data.itinerary.days.length } : {}),
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
    streetIds: trip?.streetIds,   // picked streets — scheduled as stops with their own dwell
    interests: trip?.interests,   // chosen interest chips → govern the pick (coarse fallback + reservation)
    audience: trip?.audience,     // who → audience_fit ranking (replaces the frozen curated selection)
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
  // ---- Day-editing: add / remove ONE stop, then IMMEDIATELY re-arrange the day via
  // the deterministic engine (mode:arrange — never AI). One click = added & re-sorted;
  // no batch, no separate "סדר את היום" step. ----
  async function arrangeDay(addIds: number[], removeIds: number[]) {
    if (!itinerary || busy || (!addIds.length && !removeIds.length)) return;
    setBusy("revise"); setError(null);
    try {
      const res = await fetch("/api/itinerary", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "arrange", city, current: itinerary, dayIndex: curIdx, addIds, removeIds }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.itinerary) { setError(data?.error || "אירעה שגיאה"); return; }
      // leftOut: drop the ones we added; add back the stops we removed (so they can be re-added).
      const removedAsLeftOut = (day?.stops ?? []).filter((s) => s.id != null && removeIds.includes(s.id)).map((s) => ({
        id: s.id as number, name_he: s.name, name_en: s.name, lat: s.lat ?? null, lng: s.lng ?? null,
        image_url: s.image ?? null, category: KIND_TO_CAT[s.kind] ?? "attraction", tagline_he: s.tagline ?? null,
      })) as unknown as NonNullable<typeof trip>["leftOut"];
      const newLeftOut = [...(trip?.leftOut ?? []).filter((l) => !addIds.includes(l.id)), ...(removedAsLeftOut ?? [])];
      update(tripId, { itinerary: data.itinerary, engine: "heuristic", leftOut: newLeftOut });
    } catch { setError("שגיאת רשת"); } finally { setBusy(null); }
  }
  // Add a bank / left-out pick to the day on screen (map-pin action OR bank-card button),
  // then let the engine slot it in and re-time everything.
  const addToDay = (id: number) => arrangeDay([id], []);
  const toggleExtra = (id: number) => addToDay(id);
  const toggleRemoveLocated = (li: number) => {
    const sid = day?.stops[locatedToStop[li]]?.id;
    if (sid != null) arrangeDay([], [sid]);
  };

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
    // Re-attach when photos are missing OR when the category tag (s.cat) hasn't been
    // back-filled yet on a real attraction stop — so trips built before the tag existed
    // pick it up once. (details mode only attaches fields; it never reorders.)
    const realStops = stops.filter((s) => s.id != null && s.kind !== "food" && s.kind !== "rest");
    // Also re-attach once when the fuller description hasn't been attached yet — a
    // matched stop gets `cat` AND `description` together, so a trip built before the
    // description existed re-fetches once (the key is then present, string-or-null).
    const enriched = stops.some((s) => s.image) && realStops.every((s) => s.cat != null && "description" in s);
    if (enriched) return;
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
    // Refetch when coords OR the readable detail fields are missing (older trips
    // stored neither). "tips_he" in l distinguishes never-fetched from fetched-null.
    if (lo.every((l) => l.lat != null && l.lng != null && "tips_he" in l)) return;
    leftOutCoordsRef.current = true;
    let cancelled = false;
    fetch("/api/itinerary", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "details", city, current: itinerary ?? { title: "", subtitle: "", days: [] }, leftOut: lo.map((l) => ({ id: l.id })) }) })
      .then((r) => r.json()).catch(() => null)
      .then((d) => { if (!cancelled && d?.leftOut) update(tripId, { leftOut: d.leftOut }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, city, trip?.leftOut?.length]);

  // Re-anchor to the hotel: a hotel added/moved AFTER the trip is built should make
  // each day DEPART from the stop nearest it — add a hotel by street 2 and the day
  // opens on street 2, not on street 1 across town. Keyed on the hotel position so it
  // runs once per change and never re-fights a later manual reorder. Break slots
  // (lunch/dinner/rest) stay put; only the sightseeing stops are re-sequenced.
  const hotelKey = hotelPoints.map((h) => `${h.lat.toFixed(4)},${h.lng.toFixed(4)}`).sort().join("|");
  useEffect(() => {
    if (!itinerary || !hotelPoints.length || !hotelKey) return;
    if (trip?.hotelAnchorKey === hotelKey) return;
    const isBreak = (s: Stop) => s.kind === "food" || s.kind === "rest";
    const it: Itinerary = JSON.parse(JSON.stringify(itinerary));
    let changed = false;
    for (const d of it.days) {
      const movable = d.stops.filter((s) => !isBreak(s) && s.lat != null && s.lng != null);
      if (movable.length <= 1) continue;
      // this day's depot = the hotel nearest its stops (handles multi-hotel trips)
      const depot = hotelPoints.slice().sort((h1, h2) =>
        Math.min(...movable.map((s) => haversineKm(h1.lat, h1.lng, s.lat as number, s.lng as number))) -
        Math.min(...movable.map((s) => haversineKm(h2.lat, h2.lng, s.lat as number, s.lng as number))))[0];
      // shim each movable Stop → a point/line Attraction carrying a back-ref, reorder
      // from the depot, then read the reordered Stops back off the shims.
      const shims = movable.map((s, i) => ({
        id: i, lat: s.lat as number, lng: s.lng as number,
        ends: s.path && s.path.length > 1 ? [s.path[0], s.path[s.path.length - 1]] : undefined,
        __s: s,
      }));
      const ordered = orderFromDepot(shims as unknown as Attraction[], depot) as unknown as typeof shims;
      const seq = ordered.map((o) => o.__s);
      if (seq.some((s, i) => s !== movable[i])) changed = true;
      // splice the re-sequenced stops back into the non-break slots, breaks untouched
      let mi = 0;
      d.stops = d.stops.map((s) => (isBreak(s) || s.lat == null ? s : seq[mi++]));
      d.stops = retimeStops(d.stops);
    }
    if (changed) update(tripId, { itinerary: it, hotelAnchorKey: hotelKey });
    else update(tripId, { hotelAnchorKey: hotelKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, hotelKey, itinerary]);

  // Left-out markers to show on the map: only picks within a walkable/short-transit
  // reach of the CURRENT day's stops — a far pick (Kew) isn't a sensible add to a
  // central day, so it shouldn't clutter the map for that day.
  const NEAR_KM = 3;
  const nearbyExtras = ((trip?.leftOut ?? []) as unknown as Attraction[]).filter((l) =>
    Number.isFinite(l.lat) && Number.isFinite(l.lng) &&
    mapStops.some((s) => haversineKm(s.lat as number, s.lng as number, l.lat as number, l.lng as number) <= NEAR_KM));
  // The hovered bank pick always gets a marker to light up — even a far one that the
  // NEAR_KM filter would otherwise drop (we fly the map to it, see the card handlers).
  const hoverBankItem = hoverBankId != null
    ? ((trip?.leftOut ?? []) as unknown as Attraction[]).find(
        (l) => l.id === hoverBankId && Number.isFinite(l.lat) && Number.isFinite(l.lng))
    : undefined;
  const mapExtras = hoverBankItem && !nearbyExtras.some((e) => e.id === hoverBankItem.id)
    ? [...nearbyExtras, hoverBankItem] : nearbyExtras;

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

  // Adjust the recommended stay at a stop by ±30 min (the built value is only a
  // suggestion — some travellers linger, some rush), then re-time the day.
  const bumpDwell = (di: number, si: number, deltaMin: number) =>
    mutate((it) => {
      const s = it.days[di].stops[si];
      const next = Math.max(30, Math.min(600, round30(durToMin(s.duration) + deltaMin)));
      s.duration = durationHe(next);
      it.days[di].stops = retimeStops(it.days[di].stops);
    });
  // Add a break to the current day. Dinner (no target) is appended → evening.
  // A hotel rest defaults to ~17:00 (late-afternoon freshen-up before the evening),
  // so it's inserted before the first stop at/after that time — not at day's end.
  // Either way the traveller can drag it, and the day re-times after.
  const addBreak = (kind: Stop["kind"], name: string, minutes: number, note: string, targetMin?: number, coords?: { lat: number; lng: number }) =>
    mutate((it) => {
      const stops = it.days[curIdx].stops;
      if (stops.some((s) => s.name === name)) return;   // one dinner / one rest per day
      // a hotel rest carries the hotel's coords → it shows on the map at the hotel
      // (a mid-day return home) and the route legs to/from it are real.
      const stop: Stop = { name, kind, time: "", duration: durationHe(minutes), note, lat: coords?.lat, lng: coords?.lng };
      const toMin = (t?: string) => { const [h, m] = (t || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
      let idx = stops.length;
      if (targetMin != null) {
        const at = stops.findIndex((s) => s.time && toMin(s.time) >= targetMin);
        if (at !== -1) idx = at;
      }
      stops.splice(idx, 0, stop);
      it.days[curIdx].stops = retimeStops(stops);
    });

  // Bank → day: drop a left-out pick into the current day at index `at`, re-time,
  // and remove it from the bank (all in one save).
  const insertBankAt = (di: number, at: number, id: number) => {
    if (!itinerary) return;
    const p = (trip?.leftOut ?? []).find((l) => l.id === id);
    if (!p) return;
    const stop: Stop = {
      name: p.name_he || p.name_en, kind: CAT_TO_KIND[p.category] ?? "culture", time: "", duration: "",
      id: p.id, lat: p.lat ?? undefined, lng: p.lng ?? undefined, image: p.image_url ?? undefined, tagline: p.tagline_he ?? undefined,
      cat: p.category, ...(p.manual ? { manual: true } : {}), ...(p.priceEur != null ? { priceEur: p.priceEur } : {}),
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
      // a manual place keeps its own type-tag (s.cat) and manual flag so it returns
      // to the "מקומות שהוספתי" section, not the ranked bank.
      const entry = { id: s.id, name_he: s.name, name_en: s.name, lat: s.lat ?? null, lng: s.lng ?? null,
        image_url: s.image ?? null, category: s.manual ? (s.cat ?? "other") : (KIND_TO_CAT[s.kind] ?? "attraction"),
        tagline_he: s.tagline ?? null, ...(s.manual ? { manual: true } : {}), ...(s.priceEur != null ? { priceEur: s.priceEur } : {}) };
      patch.leftOut = [entry as NonNullable<NonNullable<typeof trip>["leftOut"]>[number], ...(trip?.leftOut ?? [])];
    }
    update(tripId, patch);
  };

  // Insert an attraction (from the "more" suggestion pool OR the search box — NOT the
  // bank) into a day. `description_he` (from search) shows immediately in the expanded stop.
  const insertAttraction = (di: number, at: number, a: { id: number; name_he: string | null; name_en: string; category: string; lat?: number | null; lng?: number | null; image_url?: string | null; tagline_he?: string | null; tips_he?: string | null; description_he?: string | null }) =>
    mutate((it) => {
      const stop: Stop = { name: a.name_he || a.name_en, kind: CAT_TO_KIND[a.category] ?? "culture", time: "", duration: "",
        id: a.id, lat: a.lat ?? undefined, lng: a.lng ?? undefined, image: a.image_url ?? undefined, tagline: a.tagline_he ?? undefined,
        description: a.description_he ?? undefined, note: a.tips_he || a.tagline_he || undefined, cat: a.category };
      const stops = it.days[di].stops;
      stops.splice(Math.max(0, Math.min(at, stops.length)), 0, stop);
      it.days[di].stops = retimeStops(stops);
    });
  // Best place to slot a new stop: right after its nearest existing coord-stop, so
  // the walking route stays tight. Falls back to end-of-day.
  const bestInsertIndex = (stops: Stop[], lat: number, lng: number) => {
    let bi = stops.length, bd = Infinity;
    stops.forEach((s, i) => { if (s.lat == null || s.lng == null) return; const d = haversineKm(lat, lng, s.lat, s.lng); if (d < bd) { bd = d; bi = i + 1; } });
    return bi;
  };
  const dayCentroid = () => {
    const pts = (day?.stops ?? []).filter((s) => s.lat != null && s.lng != null);
    if (pts.length) return { lat: pts.reduce((a, s) => a + (s.lat as number), 0) / pts.length, lng: pts.reduce((a, s) => a + (s.lng as number), 0) / pts.length };
    return mapCenter[0] !== 0 || mapCenter[1] !== 0 ? { lat: mapCenter[0], lng: mapCenter[1] } : null;
  };
  // "Add any place" search — debounced free-text query over the whole city.
  useEffect(() => {
    const q = searchQ.trim();
    if (!trip?.destinationId || q.length < 2) { setSearchHits([]); setSearchBusy(false); return; }
    setSearchBusy(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/attractions/search?dest=${trip.destinationId}&q=${encodeURIComponent(q)}`);
        const d = await r.json();
        if (!cancelled) setSearchHits((d?.results ?? []) as SearchHit[]);
      } catch { if (!cancelled) setSearchHits([]); }
      finally { if (!cancelled) setSearchBusy(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ, trip?.destinationId]);
  // Add a searched place to the CURRENT day at its best geographic slot (re-times).
  const addSearchHit = (a: SearchHit) => {
    const stops = day?.stops ?? [];
    const at = a.lat != null && a.lng != null ? bestInsertIndex(stops, a.lat, a.lng) : stops.length;
    insertAttraction(curIdx, at, a);
    setSearchQ(""); setSearchHits([]);
  };
  // Paste a Google-Maps link → resolve its name + coordinates (server unfurls short
  // links too). Fills the name if empty and stores the exact location for the pin.
  const resolvePlace = async (url: string) => {
    const u = url.trim();
    if (!u) return;
    setAddBusy(true); setAddMsg(null);
    try {
      const r = await fetch(`/api/attractions/resolve-place?url=${encodeURIComponent(u)}`);
      const d = await r.json().catch(() => null);
      if (d?.lat != null && d?.lng != null) {
        setAddCoords({ lat: d.lat, lng: d.lng });
        if (d.name && !addName.trim()) setAddName(d.name);
        setAddMsg({ ok: true, text: d.name ? `✓ נמצא: ${d.name}` : "✓ מיקום נמצא" });
      } else {
        setAddMsg({ ok: false, text: "לא הצלחתי לקרוא מיקום מהקישור — אפשר להוסיף לפי שם בלבד." });
      }
    } catch {
      setAddMsg({ ok: false, text: "שגיאת רשת בקריאת הקישור." });
    } finally { setAddBusy(false); }
  };
  // Resolve a place by NAME or ADDRESS via the same geocoder the hotel form uses —
  // biased to the trip's country + city centre so a bare name ("Osteria Ovada")
  // lands in the right city. Returns the hit (and fills the name if it was blank).
  const geocodePlace = async (q: string, opts?: { fillName?: boolean }) => {
    const term = q.trim();
    if (!term) return null;
    setAddBusy(true); setAddMsg(null);
    try {
      const cc = trip?.country ? `&cc=${encodeURIComponent(trip.country)}` : "";
      const near = mapCenter[0] !== 0 || mapCenter[1] !== 0 ? `&lat=${mapCenter[0]}&lng=${mapCenter[1]}` : "";
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(term)}${cc}${near}`);
      const d = await r.json().catch(() => null);
      if (d?.found && d.lat != null && d.lng != null) {
        setAddCoords({ lat: d.lat, lng: d.lng });
        if (opts?.fillName && !addName.trim()) setAddName(term);
        // Drop the resolved address INTO the address field (not a small note below),
        // and flash the field green once so it's clear it was auto-filled.
        setAddAddress((d.label || term).split(",").slice(0, 3).join(",").trim());
        setAddMsg(null);
        setAddFlash(true);
        setTimeout(() => setAddFlash(false), 950);
        return d;
      }
      setAddMsg({ ok: false, text: "לא מצאתי מיקום — נסו כתובת מדויקת יותר, או הדביקו קישור." });
      return null;
    } catch {
      setAddMsg({ ok: false, text: "שגיאת רשת בחיפוש הכתובת." });
      return null;
    } finally { setAddBusy(false); }
  };
  // Create a manual place → prepend to the bank as a `manual` item (its own section);
  // from there it's dragged into any day like a normal bank pick.
  const addManualPlace = async () => {
    const name = addName.trim();
    if (!name) return;
    // If we still have no coordinates (no link pasted, no blur-geocode), resolve them
    // now from the address (or the name) — so the pin/re-time work like the hotel flow.
    let coords = addCoords;
    if (!coords) {
      const hit = await geocodePlace(addAddress.trim() || name, { fillName: false });
      if (hit) coords = { lat: hit.lat, lng: hit.lng };
    }
    const id = -Math.floor(Date.now());   // synthetic negative id, never collides with DB ids
    const price = addPrice.trim() ? Number(addPrice) : null;
    const entry = {
      id, name_he: name, name_en: name, image_url: null, category: addType,
      lat: coords?.lat ?? null, lng: coords?.lng ?? null,
      tagline_he: manualTypeLabel(addType).he, must_see: 0, manual: true as const,
      ...(price != null && price > 0 ? { priceEur: price } : {}),
    };
    update(tripId, { leftOut: [entry as NonNullable<NonNullable<typeof trip>["leftOut"]>[number], ...(trip?.leftOut ?? [])] });
    setAddName(""); setAddLink(""); setAddAddress(""); setAddType("food"); setAddPrice(""); setAddCoords(null); setAddMsg(null); setAddOpen(false);
  };
  const deleteManualPlace = (id: number) =>
    update(tripId, { leftOut: (trip?.leftOut ?? []).filter((l) => l.id !== id) });
  // Bank card "הוסף ליום זה": a manual place isn't in the DB, so it can't go through
  // the server arrange — insert it locally (best geo slot + re-time). Ranked DB picks
  // keep the server path (re-fits the day).
  const addBankPickToDay = (p: { id: number; lat?: number | null; lng?: number | null; manual?: boolean }) => {
    if (p.manual) {
      const at = p.lat != null && p.lng != null ? bestInsertIndex(day?.stops ?? [], p.lat, p.lng) : (day?.stops.length ?? 0);
      insertBankAt(curIdx, at, p.id);
    } else addToDay(p.id);
  };
  // "פחות אטרקציות": drop the least-valuable real stop of the day INTO the bank
  // (least = "אם יש זמן" filler first, then lowest rating). Keeps ≥1 real stop.
  const fewerAttractions = () => {
    const real = (day?.stops ?? []).map((s, i) => ({ s, i })).filter((x) => x.s.id != null && x.s.kind !== "food" && x.s.kind !== "rest");
    if (real.length <= 1) return;
    const c = dayCentroid();
    // lower "keep" = more removable: an "אם יש זמן" filler goes first, then a lower
    // rating, then the geographic OUTLIER (farthest from the day's centre) — so a
    // central must-see survives and the day-stretching stop is the one that leaves.
    const keep = (s: Stop) => {
      const dist = c && s.lat != null && s.lng != null ? haversineKm(c.lat, c.lng, s.lat, s.lng) : 0;
      return (s.anchor === true ? 2000 : s.anchor === false ? -2000 : 0) + (s.score ?? 0) * 10 - dist;
    };
    real.sort((a, b) => keep(a.s) - keep(b.s));
    moveStopToBank(curIdx, real[0].i);
  };
  // "יותר אטרקציות": pull ONE more attraction into the day — the nearest pick from
  // the bank ("לא נכנסו ליומן"); if the bank is empty, top up from profile-fitting
  // attractions for the city that aren't already in the trip.
  const moreAttractions = async () => {
    if (busy) return;
    const c = dayCentroid();
    if (!c) return;
    const near = <T extends { lat?: number | null; lng?: number | null }>(list: T[]) => {
      let best: T | null = null, bd = Infinity;
      for (const x of list) { if (x.lat == null || x.lng == null) continue; const d = haversineKm(c.lat, c.lng, x.lat, x.lng); if (d < bd) { bd = d; best = x; } }
      return best;
    };
    // 1) from the bank
    const bankPick = near((trip?.leftOut ?? []).filter((l) => l.lat != null && l.lng != null));
    if (bankPick) { insertBankAt(curIdx, bestInsertIndex(day?.stops ?? [], bankPick.lat as number, bankPick.lng as number), bankPick.id); return; }
    // 2) top up from the profile-fitting pool (server)
    setBusy("revise"); setError(null);
    try {
      const used = [...new Set([...(itinerary?.days.flatMap((d) => d.stops.map((s) => s.id)) ?? []), ...(trip?.leftOut ?? []).map((l) => l.id)].filter((x): x is number => x != null))];
      const res = await fetch("/api/itinerary", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "suggest", city, usedIds: used, taste: deriveTaste(tripProfile), isFamily: tripProfile.kids.length > 0 }) });
      const data = await res.json().catch(() => null);
      const cand = near((data?.suggestions ?? []) as { id: number; lat?: number | null; lng?: number | null; category: string; name_he: string | null; name_en: string; image_url?: string | null; tagline_he?: string | null; tips_he?: string | null }[]);
      if (cand) insertAttraction(curIdx, bestInsertIndex(day?.stops ?? [], cand.lat as number, cand.lng as number), cand);
      else setError("לא נמצאו אטרקציות נוספות מתאימות באזור");
    } catch { setError("שגיאת רשת"); } finally { setBusy(null); }
  };

  // Pointer-drag manager (mouse + touch): start on a grip, follow the finger with a
  // floating ghost, hit-test drop targets by their data-attrs, and on release route
  // to reorder / insert-from-bank / move-to-bank. Replaces HTML5 DnD so it works on
  // touch screens too. dragRef/overRef hold the live values the move/up handlers read.
  const startPointerDrag = (
    e: React.PointerEvent, item: NonNullable<typeof drag>, label: string, onTap?: () => void
  ) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    const dayLen = day?.stops.length ?? 0;
    let lastX = startX, lastY = startY, raf = 0, active = false;
    // Begin the actual drag only once the pointer moves past a small threshold, so a
    // plain tap on a card reads as "expand to read", and a drag as "move".
    const activate = () => {
      active = true;
      dragRef.current = item; overRef.current = null;
      setDrag(item); setGhost({ x: lastX, y: lastY, label });
      raf = requestAnimationFrame(tick);
    };
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
      lastX = ev.clientX; lastY = ev.clientY;
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        activate();               // crossed the threshold → it's a drag
      }
      ev.preventDefault();
      setGhost((g) => (g ? { ...g, x: ev.clientX, y: ev.clientY } : g));
      updateOver(ev.clientX, ev.clientY);
    };
    const onUp = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!active) { onTap?.(); return; }   // never moved → a tap, not a drag
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
    <main className="mx-auto w-full max-w-[440px] pb-24 lg:max-w-[1600px] lg:pb-16">
      {/* THREE THIN ROWS — the map + itinerary are the hero and fill the first
          viewport, so trip info / day tabs / day summary are compressed to slim
          horizontal strips (no big card, no poster, no permanent date inputs). */}
      {/* the three thin rows sit to the LEFT of a compact destination image
          (same 160×105 landscape treatment as the city page). The image is
          absolute so it spans the rows without adding any header height; the
          rows reserve room on the right (lg:pr) so nothing runs under it. */}
      <div className="lg:relative">
        {/* ── Editorial hero (M2a, flag only) — a cinematic city band with a serif
             title, in place of the compact 3-row header. Reuses the same actions. ── */}
        {editorial && (
          <div>
            <div className="flex items-center gap-2 px-5 pt-4 lg:px-8">
              <Link href="/trips" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-[var(--text-2)] transition hover:text-[var(--brand-ink)]">
                <ChevronRight size={14} /> הטיולים שלי
              </Link>
              <div className="ms-auto flex items-center gap-2">
                <div className="relative">
                  <button onClick={() => setDatesOpen((o) => !o)}
                    className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-2)] transition hover:border-[var(--brand)]">
                    <CalendarDays size={14} /> {dateRangeText ?? "תאריכים"}
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
                {trip && <ShareTrip trip={trip} profile={tripProfile} onShared={(shared) => update(tripId, { shared })} />}
                {trip && <EditorTools trip={trip} itinerary={itinerary} />}
                <button onClick={() => { if (confirm("למחוק את הטיול הזה? הפעולה אינה ניתנת לביטול.")) { remove(tripId); window.location.href = "/trips"; } }}
                  title="מחק טיול" aria-label="מחק טיול"
                  className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--border)] px-3 py-1.5 text-[13.5px] font-medium text-[var(--text-2)] transition hover:border-[var(--danger,#dc2626)] hover:text-[var(--danger,#dc2626)]">
                  <Trash2 size={14} /> מחק
                </button>
              </div>
            </div>
            <section className="relative mx-5 mt-3 overflow-hidden rounded-[18px] shadow-[var(--shadow)] lg:mx-8">
              {trip?.destinationId && (
                <>
                  {/* wrap in our own absolute-inset-0 box (stretches like the gradient
                      does); CityPoster fills THAT with size-full. Passing absolute to
                      CityPoster directly loses to its own `relative` in the cascade. */}
                  <div className="absolute inset-0">
                    <CityPoster destinationId={trip.destinationId} cityHe={cityHe}
                      orientation="landscape" position="50% 42%" className="size-full" />
                  </div>
                  <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(18,14,9,0.74) 0%, rgba(18,14,9,0.30) 46%, rgba(18,14,9,0.12) 100%)" }} />
                </>
              )}
              <div className="relative flex min-h-[280px] flex-col justify-end gap-3 p-7 lg:min-h-[340px] lg:p-9">
                <h1 className="serif text-[38px] font-bold leading-[0.98] text-white lg:text-[54px]" style={{ textShadow: "0 2px 20px rgba(0,0,0,0.4)" }}>{trip?.title ?? "…"}</h1>
                <div className="flex flex-wrap items-center gap-2">
                  {cityHe && <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-[13px] font-medium text-white backdrop-blur">{cityHe}</span>}
                  {!!trip?.days && <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-[13px] font-medium text-white backdrop-blur">{trip.days} ימים</span>}
                  {!!trip?.month && <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-[13px] font-medium text-white backdrop-blur">{MONTHS_HE[trip.month - 1]}</span>}
                </div>
              </div>
            </section>
          </div>
        )}
        {!editorial && (<>
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
          {/* AI upgrade — hidden unless AI is explicitly enabled. With the kill-switch
              off (default) it would just re-run the same deterministic build, so
              showing it is misleading. Flip NEXT_PUBLIC_AI_ENABLED=true to re-enable. */}
          {AI_ENABLED && itinerary && trip?.engine !== "ai" && (
            <button onClick={() => generate(true)} disabled={!!busy} title="תכנון חכם יותר עם AI — סידור, נרטיב ותובנות מטיילים"
              className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--accent)] bg-[var(--accent-soft)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--accent-ink)] disabled:opacity-50">
              <Sparkles size={14} /> שדרגו עם AI
            </button>
          )}
          {trip && (
            <ShareTrip trip={trip} profile={tripProfile}
              onShared={(shared) => update(tripId, { shared })} />
          )}
          {trip && <EditorTools trip={trip} itinerary={itinerary} />}
          {/* delete this trip (with confirm) → back to the trips list */}
          <button
            onClick={() => { if (confirm("למחוק את הטיול הזה? הפעולה אינה ניתנת לביטול.")) { remove(tripId); window.location.href = "/trips"; } }}
            title="מחק טיול" aria-label="מחק טיול"
            className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--border)] px-3 py-1.5 text-[13.5px] font-medium text-[var(--text-2)] transition hover:border-[var(--danger,#dc2626)] hover:text-[var(--danger,#dc2626)]">
            <Trash2 size={14} /> מחק
          </button>
        </div>
      </div>

      {/* creation + last-saved timestamps — a thin, unobtrusive line */}
      {trip && (
        <div className="px-5 pt-1 text-[11.5px] text-[var(--text-3)] lg:pl-8 lg:pr-[204px]">
          <span>נוצר {fmtStamp(trip.createdAt)}</span>
          {trip.updatedAt && trip.updatedAt > trip.createdAt + 1000 && (
            <span> · עודכן לאחרונה {fmtStamp(trip.updatedAt)}</span>
          )}
        </div>
      )}
        </>)}

      {/* row 2 — day tabs (thin pills) */}
      {itinerary && allDays.length > 0 && (
        <div className={`mt-1.5 flex items-center gap-2.5 px-5 ${editorial ? "lg:mt-4 lg:px-8" : "lg:pl-8 lg:pr-[204px]"}`}>
          {!editorial && <span className="hidden shrink-0 text-[12px] font-semibold text-[var(--text-3)] sm:block">ימי הטיול</span>}
          <div className={`-mx-5 flex overflow-x-auto px-5 sm:mx-0 sm:px-0 ${editorial ? "gap-0 border-b border-[var(--border)]" : "gap-1.5"}`} style={{ scrollbarWidth: "none" }}>
            {allDays.map((d, i) => {
              const on = i === curIdx;
              const today = i === todayIndex;
              if (editorial) {
                // Editorial "table of contents": each day as a titled chapter entry
                // with the neighbourhood as its subtitle and an active accent rule.
                return (
                  <button key={i} onClick={() => { setDayIdx(i); setExpanded(null); setActive(null); }}
                    className="flex shrink-0 flex-col items-start gap-0.5 border-b-2 px-4 py-2.5 text-start transition"
                    style={{ borderColor: on ? "var(--accent)" : "transparent" }}>
                    <span className="serif text-[15px] font-bold leading-none" style={{ color: on ? "var(--text)" : "var(--text-3)" }}>
                      יום {i + 1}{today ? " · היום" : ""}
                    </span>
                    <span className="text-[12px] leading-none" style={{ color: on ? "var(--brand-ink)" : "var(--text-3)" }}>
                      {d.area || `${d.stops.length} עצירות`}
                    </span>
                  </button>
                );
              }
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

      {/* Editorial chapter opener — the day reads as a magazine chapter: an oversized
          numeral, the neighbourhood as the chapter title, the day's rationale as a
          one-line intro. (Real day.title/intro come later; area/why are the stopgap.) */}
      {editorial && itinerary && day && (
        <div className="mt-7 flex items-start gap-5 px-5 lg:px-8">
          <div className="serif text-[56px] font-extrabold leading-[0.8] text-[var(--accent)] lg:text-[76px]">{String(curIdx + 1).padStart(2, "0")}</div>
          <div className="pt-1.5">
            <p className="eyebrow" style={{ color: "var(--brand-ink)" }}>יום {curIdx + 1}{allDays.length > 1 ? ` · מתוך ${allDays.length}` : ""}</p>
            <h2 className="serif mt-1 text-[28px] font-bold leading-[1.04] lg:text-[38px]">{day.area || dayLabels[curIdx]}</h2>
            {day.why && <p className="mt-2 max-w-[58ch] text-[15.5px] leading-relaxed text-[var(--text-2)]">{day.why}</p>}
          </div>
        </div>
      )}

      {/* row 3 — day summary (thin strip, no card): day label + edit + stats,
          and an on-demand "why?" toggle (no big AI explanation block) */}
      {itinerary && day && (
        <div className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-5 pb-2 ${editorial ? "lg:mt-3 lg:px-8" : "lg:pl-8 lg:pr-[204px]"}`}>
          {!editorial && <h2 className="serif text-[15px] font-bold leading-tight lg:text-[16px]">{dayLabels[curIdx]}</h2>}
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
          {/* update the day's density from the trip's attraction "bank": more pulls
              one in (from 'לא נכנסו ליומן', else a profile-fitting pick), less sends
              the weakest one back to the bank. */}
          <span className="flex items-center gap-1.5">
            <button onClick={moreAttractions} disabled={!!busy}
              className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--text-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-ink)] disabled:opacity-40">
              {busy === "revise" ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} יותר אטרקציות
            </button>
            <button onClick={fewerAttractions}
              disabled={!!busy || (day.stops.filter((s) => s.id != null && s.kind !== "food" && s.kind !== "rest").length <= 1)}
              className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--text-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-ink)] disabled:opacity-40">
              <Minus size={12} /> פחות אטרקציות
            </button>
          </span>
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
          ) : (!editorial && day.area) && (
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
        </div>
      )}
      </div>{/* /lg:relative header wrapper (rows + destination image) */}

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
                extras={mapExtras} hoveredId={hoverBankId}
                onToggleExtra={toggleExtra} onToggleRemove={toggleRemoveLocated}
                onStopClick={(li) => { const si = locatedToStop[li]; if (si == null) return;
                  setExpanded(`${curIdx}-${si}`); setActive(li); setMobileTab("plan"); }} />
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
              {/* Add a dinner (1½h) or hotel rest — pinned at the TOP of the day so
                  it's easy to reach; the break itself still drops into its right time
                  slot (dinner in the evening) and can be dragged to reposition. */}
              <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--border)] py-3 text-[13px]">
                <span className="text-[var(--text-3)]">הוסיפו:</span>
                <button onClick={() => addBreak("food", "ארוחת ערב", 90, "מסעדה מקומית באזור")}
                  disabled={day.stops.some((s) => s.name === "ארוחת ערב")}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3.5 py-1.5 font-semibold text-[var(--brand-ink)] shadow-[var(--shadow)] transition hover:bg-[var(--brand)] hover:text-white disabled:opacity-40 disabled:shadow-none disabled:hover:bg-[var(--brand-soft)] disabled:hover:text-[var(--brand-ink)]">
                  <Utensils size={13} /> ארוחת ערב
                </button>
                <button onClick={() => addBreak("rest", "מנוחה במלון", 60, "חזרה למלון להתרעננות", 17 * 60, hotelPoints[0] ? { lat: hotelPoints[0].lat, lng: hotelPoints[0].lng } : undefined)}
                  disabled={day.stops.some((s) => s.name === "מנוחה במלון")}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3.5 py-1.5 font-semibold text-[var(--brand-ink)] shadow-[var(--shadow)] transition hover:bg-[var(--brand)] hover:text-white disabled:opacity-40 disabled:shadow-none disabled:hover:bg-[var(--brand-soft)] disabled:hover:text-[var(--brand-ink)]">
                  <Coffee size={13} /> מנוחה במלון
                </button>
              </div>
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
                    <div className={`group/row -mx-2 flex gap-2 rounded-[12px] px-2 transition-colors lg:gap-3 ${hasDetails ? "cursor-pointer" : ""}`}
                         style={{ background: isActive ? `color-mix(in srgb, ${col} 12%, transparent)` : "transparent" }}
                         onMouseEnter={() => { if (ci != null) { setActive(ci);
                           // slide the map toward the hovered stop (keeping the day
                           // overview) — same idea as a bank card centring its place.
                           if (s.lat != null && s.lng != null) setFocus({ lat: s.lat, lng: s.lng, n: Date.now(), keepZoom: true }); } }}
                         onMouseLeave={() => setActive(null)}
                         onClick={() => hasDetails && setExpanded(isOpen ? null : key)}>
                      {/* leading controls — both appear on row hover, side by side with a
                          gap between them: grip to drag-reorder, and a quick delete (the
                          gap keeps the destructive action from being an easy misclick).
                          Hidden on the auto lunch row (it's re-timed, not user-managed). */}
                      {/* fixed width on desktop so a grip-only row (the meal break) reserves
                          the SAME space as grip+delete rows — keeps the time column aligned. */}
                      <div className="flex flex-col items-center gap-1.5 self-center opacity-100 transition-opacity lg:order-last lg:w-[60px] lg:flex-row lg:items-center lg:justify-start lg:gap-2 lg:pl-1 lg:opacity-0 lg:group-hover/row:opacity-100">
                        <span
                          onPointerDown={(e) => startPointerDrag(e, { kind: "stop", si }, s.name)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ touchAction: "none" }}
                          className="grid size-6 cursor-grab touch-none select-none place-items-center text-[var(--text-3)] [-webkit-touch-callout:none] active:cursor-grabbing" title="גררו לשינוי סדר · או אל 'לא נכנסו' כדי להוציא">
                          <GripVertical size={16} />
                        </span>
                        {/* delete for real stops + user-added breaks (dinner/rest); only
                            the auto lunch break is non-deletable (it's re-added on re-time) */}
                        {s.name !== "הפסקת צהריים" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteStop(curIdx, si); }}
                            title="מחק עצירה" aria-label="מחק עצירה"
                            className="grid size-6 place-items-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger,#dc2626)]">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      {/* photo (falls back to the kind icon). Editorial: a large landscape
                          frame so each stop leads with its image (photo-forward, M3a). */}
                      <div className={editorial ? "self-center py-2.5" : "py-2.5 pr-1"}>
                        {s.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={editorial ? (bigImage(s.image, 360) ?? s.image) : s.image} alt="" loading="lazy"
                            onError={editorial ? (e) => { const t = e.currentTarget; if (s.image && t.src !== s.image) t.src = s.image; } : undefined}
                            className={editorial
                              ? "h-[94px] w-[136px] rounded-[13px] bg-[var(--surface-2)] object-cover shadow-[var(--shadow)]"
                              : "size-12 rounded-[12px] object-cover"} />
                        ) : editorial ? (
                          <div className="grid h-[94px] w-[136px] place-items-center rounded-[13px] border border-[var(--border)] bg-[var(--surface-2)]">
                            <StopIcon kind={s.kind} />
                          </div>
                        ) : (
                          <StopIcon kind={s.kind} />
                        )}
                      </div>
                      {/* name + details */}
                      <div className="min-w-0 flex-1 py-2.5">
                        {/* top line: the NAME is the hero — it gets the whole block width;
                            only the expand chevron sits at the far end. Rating + stay time
                            drop to the meta line below so the name is never squeezed. */}
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <p className={`line-clamp-2 font-semibold leading-snug ${editorial ? "serif text-[19px] lg:text-[21px]" : "text-[16.5px]"}`}>{s.name}</p>
                            {fromSelection && s.anchor === true && (
                              <span className="shrink-0 rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--brand-ink)]">עוגן</span>
                            )}
                            {fromSelection && s.anchor === false && (
                              <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-3)]">אם יש זמן</span>
                            )}
                          </div>
                          {/* chevron slot always present so nothing shifts between rows */}
                          <span className="mt-0.5 grid w-4 shrink-0 place-items-center">
                            {hasDetails && (
                              <ChevronDown size={16}
                                className={`text-[var(--text-3)] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            )}
                          </span>
                        </div>
                        {/* meta line: rating + recommended stay (labelled so it isn't read
                            as an arrival/travel time) */}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-[var(--text-3)]">
                          {(() => {
                            // "what is this" tag — the specific subcategory (מוזיאון / פארק /
                            // טירה / שוק…) when we have it, else the broad category. Skips
                            // logistical break stops (lunch / hotel rest).
                            // A street is a LINE (has a path) / carries a "street:" ref — it
                            // isn't a DB attraction, so label it "רחוב" directly (older trips
                            // never get its cat from the details re-attach, which is points-only).
                            const isStreet = (s.ref?.startsWith("street") ?? false) || (!!s.path && s.kind !== "nature");
                            // a traveller-added place shows the type-tag it was created with
                            // (מסעדה / בר / קזינו…), not the broad "אוכל" kind label.
                            const label = s.manual ? manualTypeLabel(s.cat || "other").he
                              : isStreet ? "רחוב"
                              : catLabel(s.cat, s.sub)
                              || (s.kind !== "food" && s.kind !== "rest" ? (KIND_META[s.kind]?.label ?? "") : "");
                            if (!label) return null;
                            const col = isStreet ? "var(--brand-ink)" : catColor(s.cat || "attraction");
                            return (
                              <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                                style={{ background: `color-mix(in srgb, ${col} 14%, var(--surface))`, color: col }}>
                                {label}
                              </span>
                            );
                          })()}
                          {!!s.score && (
                            <span className="flex items-center gap-1 font-medium text-[var(--accent-ink)]">
                              <Star size={12} fill="currentColor" /><span className="tabular-nums">{s.score}</span>
                            </span>
                          )}
                          {/* estimated entry price per person (band-based, or a manual
                              place's own price) — the itemised half of the budget. A
                              logistical break (auto lunch / rest) has no price → hidden. */}
                          {(() => {
                            const e = stopEntryPerPerson(s);
                            if (e == null) return null;
                            return (
                              <span className="tabular-nums" title="מחיר משוער לאדם">
                                {e > 0 ? `≈€${e}` : "חינם"}
                              </span>
                            );
                          })()}
                          {s.duration && (
                            <span className="flex items-center gap-1" title="משך שהייה — לחצו +/− לכוונון (חצי שעה)">
                              <Hourglass size={11} className="shrink-0" />
                              <button onClick={(e) => { e.stopPropagation(); bumpDwell(curIdx, si, -30); }} aria-label="פחות זמן"
                                className="grid size-[18px] place-items-center rounded border border-[var(--border)] text-[13px] leading-none text-[var(--text-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-ink)]">−</button>
                              <span className="min-w-[54px] text-center">{stayHe(s.duration)}</span>
                              <button onClick={(e) => { e.stopPropagation(); bumpDwell(curIdx, si, 30); }} aria-label="יותר זמן"
                                className="grid size-[18px] place-items-center rounded border border-[var(--border)] text-[13px] leading-none text-[var(--text-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-ink)]">+</button>
                            </span>
                          )}
                        </div>
                        {s.note && <p className={`mt-1 text-[13.5px] leading-snug text-[var(--text-2)] ${isOpen ? "" : "line-clamp-2"}`}>{s.note}</p>}
                        {/* A logistical meal BREAK has no place of its own — offer "restaurants
                            nearby", centred on the last stop before it. A real/added restaurant
                            (has its own id) IS the place, so it gets no such link. */}
                        {s.kind === "food" && s.id == null && (() => {
                          const near = [...day.stops.slice(0, si)].reverse().find((x) => x.lat != null && x.lng != null);
                          if (!near) return null;
                          return (
                            <a href={googleMapsNearby(near.lat as number, near.lng as number, "מסעדות")}
                              target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-[12.5px] text-[var(--text-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-ink)]">
                              <Utensils size={12} /> מסעדות בסביבה
                            </a>
                          );
                        })()}
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
                          // Natural aspect ratio (bounded), NOT a forced landscape crop — a
                          // tall subject (a tower) shows tall, a wide one wide; nothing is
                          // cropped or squished. ~960px source keeps it crisp on retina.
                          <img src={bigImage(s.image, 960)} alt="" loading="lazy"
                            onError={(e) => { const t = e.currentTarget; if (s.image && t.src !== s.image) t.src = s.image; }}
                            className="mb-3 mx-auto block max-h-[440px] w-auto max-w-full rounded-[10px]" />
                        )}
                        {s.tagline && s.tagline !== s.note && (
                          <p className="mb-2 text-[14.5px] italic text-[var(--text-2)]">{s.tagline}</p>
                        )}
                        {s.description && (
                          <p className="mb-2.5 text-[13.5px] leading-relaxed text-[var(--text-2)]">{s.description}</p>
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
                            <a href={googleMapsPin(s.lat, s.lng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[13.5px] text-[var(--text-2)]">
                              <MapPin size={13} /> פתח במפה
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
          {(!!trip?.destinationId || (trip?.leftOut?.length ?? 0) > 0 || drag?.kind === "stop") && (
            <div data-drop-bank
              className="mt-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors"
              style={overBank ? { borderColor: "var(--brand)", boxShadow: "inset 0 0 0 2px var(--brand)" } : undefined}>
              <p className="serif text-[15px] font-bold text-[var(--text)]">בנק המקומות — לפי חשיבות · {(trip?.leftOut ?? []).filter((l) => !l.manual).length}</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--text-2)]">
                {drag?.kind === "stop"
                  ? "שחררו כאן כדי להוציא את העצירה מהיומן."
                  : "מה שלא נכנס ליומן, מסודר לפי חשיבות (⭐ = חובה). לחצו \"הוסף ליום זה\" (או גררו כרטיס אל היום) — או גררו עצירה לכאן כדי להוציא."}
              </p>

              {/* "add any place" search — the bank is only the ranked leftOut; this reaches the
                  whole city so a traveller can add a specific place they remembered (no rebuild).
                  Adds to the CURRENT day at the best geographic slot + re-times. */}
              {!!trip?.destinationId && drag?.kind !== "stop" && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2">
                    <Search size={15} className="shrink-0 text-[var(--text-3)]" />
                    <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
                      placeholder={`חיפוש והוספה של כל מקום ב${cityHe || "עיר"}…`}
                      className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[var(--text-3)]" />
                    {searchQ && (
                      <button onClick={() => { setSearchQ(""); setSearchHits([]); }} aria-label="נקה חיפוש"
                        className="shrink-0 text-[var(--text-3)] transition hover:text-[var(--text)]"><X size={15} /></button>
                    )}
                  </div>
                  {searchQ.trim().length >= 2 && (() => {
                    const usedIds = new Set<number>([
                      ...(itinerary?.days.flatMap((d) => d.stops.map((s) => s.id)) ?? []),
                      ...(trip?.leftOut ?? []).map((l) => l.id),
                    ].filter((x): x is number => x != null));
                    const hits = searchHits.filter((h) => !usedIds.has(h.id));
                    return (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {searchBusy && hits.length === 0 && <p className="px-1 text-[12.5px] text-[var(--text-3)]">מחפש…</p>}
                        {!searchBusy && hits.length === 0 && <p className="px-1 text-[12.5px] text-[var(--text-3)]">לא נמצאו מקומות מתאימים — נסו שם אחר.</p>}
                        {hits.slice(0, 8).map((h) => {
                          return (
                            <div key={h.id} className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-1.5">
                              {h.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={bigImage(h.image_url, 120)} alt="" loading="lazy" className="size-10 shrink-0 rounded-[8px] object-cover" />
                              ) : (
                                <div className="grid size-10 shrink-0 place-items-center rounded-[8px]" style={{ background: `color-mix(in srgb, ${catColor(h.category)} 16%, var(--surface))` }}>
                                  <MapPin size={15} style={{ color: catColor(h.category) }} />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold">
                                  {h.must_see === 1 && <span className="text-[var(--accent-ink)]">⭐ </span>}
                                  {h.name_he || h.name_en}
                                </p>
                                <p className="truncate text-[11.5px] text-[var(--text-3)]">{catLabel(h.category)}{h.tagline_he ? ` · ${h.tagline_he}` : ""}</p>
                              </div>
                              <button onClick={() => addSearchHit(h)}
                                className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand)] px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:opacity-90">
                                <Plus size={13} /> הוסף ליום {curIdx + 1}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* "מקומות שהוספתי" — traveller-added places (a restaurant a friend
                  recommended, or one picked from our "מסעדות בסביבה" Google-Maps link).
                  Typed or resolved from a pasted link, tagged, and dragged into any day —
                  unlike a hotel (which anchors every day), each belongs to one day. */}
              {drag?.kind !== "stop" && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-bold text-[var(--text-2)]">
                      מקומות שהוספתי{(trip?.leftOut ?? []).some((l) => l.manual) ? ` · ${(trip?.leftOut ?? []).filter((l) => l.manual).length}` : ""}
                    </p>
                    <button onClick={() => setAddOpen((v) => !v)}
                      className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[12px] font-medium text-[var(--text-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-ink)]">
                      {addOpen ? <X size={13} /> : <Plus size={13} />} {addOpen ? "סגור" : "הוסף מקום"}
                    </button>
                  </div>

                  {addOpen && (
                    <div className="mt-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] p-3">
                      {/* Name — on blur we try to locate it automatically (like the hotel form),
                          so a well-known place needs no address at all. */}
                      <input value={addName} onChange={(e) => { setAddName(e.target.value); setAddCoords(null); }}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && !addCoords && !addAddress.trim()) geocodePlace(v, { fillName: false }); }}
                        placeholder="שם המקום (למשל: מסעדת דישום)"
                        className="w-full rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13.5px] outline-none focus:border-[var(--brand)]" />
                      {/* Location — TWO ways, either/or: type an address, OR paste a Google-Maps link. */}
                      <p className="mt-2 text-[11.5px] text-[var(--text-3)]">מיקום — כתובת או קישור (או פשוט השם למעלה, וננסה לאתר):</p>
                      <input value={addAddress} onChange={(e) => { setAddAddress(e.target.value); setAddCoords(null); }}
                        onBlur={(e) => e.target.value.trim() && !addCoords && geocodePlace(e.target.value)}
                        placeholder={`כתובת / עיר (למשל: דרך ג'אפה 5, ${cityHe || "העיר"})`}
                        className={`mt-1 w-full rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--brand)] ${addFlash ? "field-flash" : ""}`} />
                      <div className="mt-1 flex items-center gap-2">
                        <span className="shrink-0 text-[11px] text-[var(--text-3)]">או</span>
                        <input value={addLink} onChange={(e) => setAddLink(e.target.value)}
                          onBlur={(e) => e.target.value.trim() && resolvePlace(e.target.value)}
                          onPaste={(e) => { const v = e.clipboardData.getData("text"); if (v.trim()) setTimeout(() => resolvePlace(v), 0); }}
                          placeholder="הדביקו קישור מגוגל מפה"
                          className="min-w-0 flex-1 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--brand)]" dir="ltr" />
                        <button onClick={() => resolvePlace(addLink)} disabled={addBusy || !addLink.trim()}
                          className="shrink-0 rounded-[9px] border border-[var(--border)] px-3 py-2 text-[12.5px] text-[var(--text-2)] transition hover:border-[var(--brand)] disabled:opacity-40">
                          {addBusy ? "…" : "פענח"}
                        </button>
                      </div>
                      {addMsg && <p className={`mt-1.5 text-[12px] ${addMsg.ok ? "text-[var(--brand-ink)]" : "text-[var(--text-3)]"}`}>{addMsg.text}</p>}
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {MANUAL_TYPES.map((t) => (
                          <button key={t.key} onClick={() => setAddType(t.key)}
                            className={`rounded-full border px-2.5 py-1 text-[12px] transition ${addType === t.key ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]" : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--brand)]"}`}>
                            {t.emoji} {t.he}
                          </button>
                        ))}
                      </div>
                      <label className="mt-2.5 flex items-center gap-2 text-[12.5px] text-[var(--text-2)]">
                        <span className="shrink-0">מחיר משוער לאדם (€):</span>
                        <input type="number" min={0} inputMode="numeric" value={addPrice}
                          onChange={(e) => setAddPrice(e.target.value)} placeholder="לא חובה"
                          className="w-24 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" dir="ltr" />
                      </label>
                      <button onClick={addManualPlace} disabled={!addName.trim()}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-[13.5px] font-medium text-white transition hover:opacity-90 disabled:opacity-40">
                        <Plus size={14} /> הוסף לבנק
                      </button>
                    </div>
                  )}

                  {(trip?.leftOut ?? []).filter((p) => p.manual).length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {(trip?.leftOut ?? []).filter((p) => p.manual).map((p) => {
                        const tag = manualTypeLabel(p.category);
                        return (
                          <div key={p.id}
                            onMouseEnter={() => { setHoverBankId(p.id); if (p.lat != null && p.lng != null) setFocus({ lat: p.lat, lng: p.lng, n: Date.now() }); }}
                            onMouseLeave={() => setHoverBankId(null)}
                            className={`flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-2 transition-colors ${hoverBankId === p.id ? "border-[var(--brand)]" : ""} ${drag?.kind === "bank" && drag.id === p.id ? "opacity-40" : ""}`}>
                            <span onPointerDown={(e) => startPointerDrag(e, { kind: "bank", id: p.id }, p.name_he || p.name_en)}
                              style={{ touchAction: "none" }} title="גררו אל היום"
                              className="grid size-6 shrink-0 cursor-grab touch-none select-none place-items-center text-[var(--text-3)] [-webkit-touch-callout:none] active:cursor-grabbing"><GripVertical size={16} /></span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[14px] font-semibold">{p.name_he || p.name_en}</p>
                              <p className="truncate text-[11.5px] text-[var(--text-3)]">
                                {tag.emoji} {tag.he}{p.priceEur != null ? ` · ≈€${p.priceEur} לאדם` : ""}{p.lat == null ? " · ללא מיקום" : ""}
                              </p>
                            </div>
                            {p.lat != null && p.lng != null && (
                              <a href={googleMapsPin(p.lat, p.lng)} target="_blank" rel="noreferrer" title="פתח במפה"
                                className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--text-3)] transition hover:text-[var(--brand-ink)]"><MapPin size={15} /></a>
                            )}
                            <button onClick={() => addBankPickToDay(p)} title="הוסף ליום זה"
                              className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand)] hover:text-white">
                              <Plus size={13} /> ליום {curIdx + 1}
                            </button>
                            <button onClick={() => deleteManualPlace(p.id)} aria-label="מחק מקום"
                              className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--text-3)] transition hover:text-[var(--danger,#dc2626)]"><Trash2 size={14} /></button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2">
                {(trip?.leftOut ?? []).filter((p) => !p.manual).map((p) => {
                  const bKey = `bank-${p.id}`;
                  const bOpen = expanded === bKey;
                  // is there anything worth reading before it goes into the day?
                  const bHasDetails = !!(p.image_url || p.website || p.best_time_he || p.dress_he ||
                    p.cost_level != null || p.tips_he || (p.tagline_he && p.tagline_he !== p.tips_he));
                  return (
                  <div key={p.id}
                    onMouseEnter={() => {
                      setHoverBankId(p.id);
                      // near picks are already on-screen (highlight in place, like a day
                      // stop); fly only to a far pick so it comes into view lit up.
                      if (p.lat != null && p.lng != null && !nearbyExtras.some((e) => e.id === p.id))
                        setFocus({ lat: p.lat, lng: p.lng, n: Date.now() });
                    }}
                    onMouseLeave={() => setHoverBankId(null)}
                    className={`shrink-0 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] transition-colors ${hoverBankId === p.id ? "border-[var(--brand)]" : ""} ${drag?.kind === "bank" && drag.id === p.id ? "opacity-40" : ""}`}>
                    {/* tap to read (expand), drag to move — a small move threshold in
                        startPointerDrag tells them apart */}
                    <div
                      onPointerDown={(e) => startPointerDrag(e, { kind: "bank", id: p.id }, p.name_he || p.name_en,
                        bHasDetails ? () => setExpanded(bOpen ? null : bKey) : undefined)}
                      style={{ touchAction: "none" }}
                      className="flex cursor-grab touch-none select-none items-center gap-3 p-2 [-webkit-touch-callout:none] active:cursor-grabbing">
                      <span className="grid size-6 shrink-0 place-items-center text-[var(--text-3)]" title="גררו אל היום"><GripVertical size={16} /></span>
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt="" loading="lazy" className="size-11 shrink-0 rounded-[8px] object-cover" />
                      ) : (
                        <div className="grid size-11 shrink-0 place-items-center rounded-[8px] bg-[var(--surface-2)] text-[var(--text-3)]"><MapPin size={16} /></div>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                        {p.must_see === 1 && <span className="ml-1 align-middle text-[var(--accent-ink)]" title="אתר חובה">⭐</span>}
                        {p.name_he || p.name_en}
                      </span>
                      {/* one-click add to the day on screen — the engine then slots it in
                          and re-times the day (same as the map pin's "הוסף ליום זה"). */}
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); addToDay(p.id); }}
                        disabled={!!busy}
                        className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand)] hover:text-white disabled:opacity-40"
                        title="הוסף ליום זה">
                        <Plus size={13} /> הוסף ליום זה
                      </button>
                      <span className="grid w-4 shrink-0 place-items-center">
                        {bHasDetails && <ChevronDown size={16} className={`text-[var(--text-3)] transition-transform ${bOpen ? "rotate-180" : ""}`} />}
                      </span>
                    </div>
                    {/* readable details — the same a scheduled stop shows, minus the time */}
                    {bOpen && (
                      <div className="border-t border-[var(--border)] px-3 pb-3 pt-3">
                        {p.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={bigImage(p.image_url, 960)} alt="" loading="lazy"
                            onError={(e) => { const t = e.currentTarget; if (p.image_url && t.src !== p.image_url) t.src = p.image_url; }}
                            className="mb-3 mx-auto block max-h-[440px] w-auto max-w-full rounded-[10px]" />
                        )}
                        {p.tagline_he && <p className="mb-2 text-[14.5px] italic text-[var(--text-2)]">{p.tagline_he}</p>}
                        {p.tips_he && <p className="mb-2 text-[13.5px] leading-snug text-[var(--text-2)]">{p.tips_he}</p>}
                        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13.5px] text-[var(--text-2)]">
                          {p.best_time_he && <span><span className="text-[var(--text-3)]">מתי: </span>{p.best_time_he}</span>}
                          {p.dress_he && <span><span className="text-[var(--text-3)]">לבוש: </span>{p.dress_he}</span>}
                          {p.cost_level != null && <span><span className="text-[var(--text-3)]">עלות: </span>{COST_HE[p.cost_level] ?? ""}</span>}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {p.website && (
                            <a href={p.website} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[13.5px] text-[var(--blue)]">
                              <ExternalLink size={13} /> אתר רשמי
                            </a>
                          )}
                          {p.lat != null && p.lng != null && (
                            <a href={googleMapsPin(p.lat, p.lng)} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[13.5px] text-[var(--text-2)]">
                              <MapPin size={13} /> פתח במפה
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
        </div>

        {/* aside (left on desktop): the day's map + hotels + trip tools. Fixed 380px to
            match the destination-page map rail — the itinerary column (lg:flex-1) absorbs
            the freed width. */}
        <aside className="lg:sticky lg:top-[73px] lg:w-[380px] lg:shrink-0">
          {/* map of the selected day — desktop; mobile uses the מפה tab */}
          {(stopPoints.length > 0 || hotelPoints.length > 0) && (
            <div className="hidden lg:block">
              <div className="relative">
                <div className="h-[calc(100dvh-265px)] max-h-[700px] min-h-[440px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
                  <MapClient attractions={stopPoints} center={mapCenter} selected={null} ordered
                    hotels={hotelPoints} focus={focus} colors={stopColors} activeIdx={active}
                extras={mapExtras} hoveredId={hoverBankId}
                onToggleExtra={toggleExtra} onToggleRemove={toggleRemoveLocated}
                    onStopClick={(li) => { const si = locatedToStop[li]; if (si == null) return;
                      setExpanded(`${curIdx}-${si}`); setActive(li);
                      requestAnimationFrame(() => stopRefs.current[si]?.scrollIntoView({ behavior: "smooth", block: "center" })); }} />
                </div>

                {/* legend — a collapsible floating card tying numbers to names. */}
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
