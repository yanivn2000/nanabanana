// Shared trip types — used by client components and the server AI layer.

// Meaningful attractions per day by pace — the SINGLE source used both for the
// city page's capacity promise ("N ימים מספיקים לכ-…") and the heuristic
// builder's per-day count, so what's promised is what gets built.
export const PACE_PER_DAY: Record<string, number> = { "רגוע": 4, "בינוני": 5, "אינטנסיבי": 6 };
// `pace` may be a legacy label (רגוע/בינוני/אינטנסיבי) or, now, a direct
// attractions-per-day number (as a string, e.g. "3"…"6"). Prefer the number.
export const paceToPerDay = (pace?: string | number): number => {
  const n = typeof pace === "number" ? pace : Number(pace);
  if (Number.isFinite(n) && n >= 1 && n <= 12) return Math.round(n);
  return PACE_PER_DAY[(pace as string) ?? ""] ?? 5;
};

// --- Day shape ---------------------------------------------------------------
// A stop count is a poor proxy for a day: Big Ben is ten minutes from the
// pavement, the Rijksmuseum is three hours. So a day is filled by TIME, up to
// dinner, and the traveller removes what they don't want. Two modes only:
//
//   רגיל      — the default: tour until dinner (~19:30, the client drops the
//               dinner slot at the first stop boundary past it, so it lands
//               19:30-20:30 depending on how the last stop falls).
//   רגוע מאוד — a deliberately light day that winds down late afternoon.
//
// minutes = the touring budget (dwell + travel) EXCLUDING the lunch break;
// maxStops is only a runaway guard — time is what binds.
export type PaceMode = "calm" | "normal";
export const PACE_MODES: Record<PaceMode, { he: string; minutes: number; maxStops: number }> = {
  normal: { he: "רגיל", minutes: 540, maxStops: 8 },      // 09:30 → ~19:30 minus lunch
  calm:   { he: "רגוע מאוד", minutes: 330, maxStops: 5 }, // 09:30 → ~16:00 minus lunch
};
export const DEFAULT_PACE: PaceMode = "normal";
// Read a mode off whatever the profile carries (new key, legacy label, or the
// old per-day number — only the very lightest of those means "calm").
export const paceMode = (pace?: string | number): PaceMode => {
  if (pace === "calm" || pace === "רגוע מאוד") return "calm";
  if (pace === "normal" || pace === "רגיל") return "normal";
  const n = typeof pace === "number" ? pace : Number(pace);
  if (Number.isFinite(n)) return n <= 3 ? "calm" : "normal";
  if (pace === "רגוע") return "calm";
  return DEFAULT_PACE;
};
export const paceBudget = (pace?: string | number) => PACE_MODES[paceMode(pace)];

export type StopKind = "nature" | "food" | "culture" | "rest" | "shopping";

export type Stop = {
  name: string;
  kind: StopKind;
  time: string;
  duration: string;
  score?: number;
  note?: string;
  // DB attraction id, matched back on build — lets us key the transport edge
  // graph (attraction_edges) on real place pairs.
  id?: number;
  // Canonical cross-kind identity: "attr:123" | "street:4" | "zone:12".
  ref?: string;
  // A street stop's full polyline → drawn as a LINE on the map (not just a pin).
  path?: [number, number][];
  // Two-tier day (Explore build): true = day anchor (a chosen "כן"/must-see),
  // false = an "אם יש זמן" filler. Undefined = not built from a selection, or a
  // logistical stop (meal/rest) that matched no attraction.
  anchor?: boolean;
  // Details matched back from the DB attraction (for the expandable view).
  nameEn?: string | null;        // English name — shown under the Hebrew name (like the city card)
  image?: string | null;
  website?: string | null;
  lat?: number | null;
  lng?: number | null;
  tagline?: string | null;
  description?: string | null;   // fuller encyclopedic paragraph (shown in the expanded stop)
  wiki?: string | null;          // authoritative source (Wikipedia article) the description came from
  bestTime?: string | null;
  dress?: string | null;
  cost?: number | null;
  // DB category / subcategory — drives the little "what is this" tag (מוזיאון / פארק…).
  cat?: string | null;
  sub?: string | null;
  // A place the traveller added by hand (typed / pasted from a Google-Maps link) —
  // NOT a DB attraction. Carries a synthetic negative id; never re-matched to the pool.
  manual?: boolean;
  // Manual place's own known price per person (€) — used by the budget instead of a
  // band; everyone in the party pays it (a chosen dinner/ticket, not a 60%-kid entry).
  priceEur?: number;
  // The meal SLOT this stop fills, when a break ("הפסקת צהריים" / "ארוחת ערב") was
  // replaced by a real eatery. Keeps the stop rendering as a full-width meal strip
  // (not a photo card) and lets it show both the place name and which meal it is.
  meal?: string;
};

export type Day = {
  label: string;
  date: string;
  base: string;
  stops: Stop[];
  why?: string;
  // Neighbourhood framing (feature C): the area this day mostly explores, and how
  // to get there from the centre (only set for out-of-centre areas).
  area?: string;
  gateway?: string;
  // Car star-trip day (car_base cities): this day is a drive out of the base to a
  // far cluster, not a walkable in-city day. Drive metrics + anchor coords for a
  // "navigate" deep-link. See lib/daytrips.ts.
  dayTrip?: { driveMin: number; driveKm: number; anchorLat?: number | null; anchorLng?: number | null };
  // The whole trip is a rental-car trip (car_base city): between-stop legs are
  // framed as driving, not public transit.
  carBase?: boolean;
};

export type Itinerary = {
  title: string;
  subtitle: string;
  days: Day[];
};

export type FamilyProfile = {
  travellers: string;
  tags: string[];
};
