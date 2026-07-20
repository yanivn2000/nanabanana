// Shared trip types — used by client components and the server AI layer.

// Meaningful attractions per day by pace — the SINGLE source used both for the
// city page's capacity promise ("N ימים מספיקים לכ-…") and the heuristic
// builder's per-day count, so what's promised is what gets built.
export const PACE_PER_DAY: Record<string, number> = { "רגוע": 4, "בינוני": 5, "אינטנסיבי": 6 };
export const paceToPerDay = (pace?: string): number => PACE_PER_DAY[pace ?? ""] ?? 5;

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
  // Two-tier day (Explore build): true = day anchor (a chosen "כן"/must-see),
  // false = an "אם יש זמן" filler. Undefined = not built from a selection, or a
  // logistical stop (meal/rest) that matched no attraction.
  anchor?: boolean;
  // Details matched back from the DB attraction (for the expandable view).
  image?: string | null;
  website?: string | null;
  lat?: number | null;
  lng?: number | null;
  tagline?: string | null;
  bestTime?: string | null;
  dress?: string | null;
  cost?: number | null;
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
