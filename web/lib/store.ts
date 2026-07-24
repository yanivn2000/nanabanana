"use client";

import { useEffect, useRef, useState } from "react";
import type { Itinerary } from "./trip-types";
import { useSessionUser } from "./auth";
import { fetchServerTrips, upsertServerTrip, deleteServerTrip, mergeTrips } from "./trips-sync";

// randomUUID only exists in secure contexts (HTTPS/localhost); we serve over
// plain HTTP, so fall back to a good-enough id everywhere.
export function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  );
}

export type Kid = { name: string; age: number; loves: string };

export type FamilyProfile = {
  adults: number;
  kids: Kid[];
  interests: string[];     // טבע, אוכל, תרבות, קניות, ספורט, חופים
  dislikes: string[];
  pace: "רגוע" | "בינוני" | "אינטנסיבי";
  budget: "חסכוני" | "בינוני" | "מפנק";
  dailyDriveHours: number;
  lodging: string;         // מלון / אירבנב / צימר
  accessibility?: string[]; // כיסא גלגלים / ללא מדרגות / נגיש לעגלה …
  dietary?: string[];       // ללא גלוטן / צמחוני / כשר …
  taste?: Record<string, number>; // explicit taste weights (equalizer, #63/#66)
  walkPref?: number;        // 1-5: how far the traveler will walk between stops (see WALK_PREF_KM)
};

export const DEFAULT_PROFILE: FamilyProfile = {
  adults: 2,
  kids: [],
  // Blank slate — onboarding says "בחרו נושאים שאתם אוהבים"; a pre-checked
  // interest contradicted that and silently dimmed everything else on day one.
  interests: [],
  dislikes: [],
  pace: "בינוני",
  budget: "בינוני",
  dailyDriveHours: 1,
  lodging: "מלון",
  accessibility: [],
  dietary: [],
  walkPref: 3,
};

const KEY = "nanabanana.profile.v1";

// Renamed interest chips — migrate saved profiles on hydrate so old selections
// keep working under the new vocabulary.
const INTEREST_RENAMES: Record<string, string> = { "מוזיקה חיה": "מוזיקה" };
function migrateInterests(list: unknown): string[] {
  return Array.isArray(list) ? [...new Set(list.map((v) => INTEREST_RENAMES[v as string] ?? (v as string)))] : [];
}

// localStorage-backed state. SSR-safe (starts from default, hydrates on mount).
export function useProfile(): [FamilyProfile, (p: FamilyProfile) => void, boolean] {
  const [profile, setProfile] = useState<FamilyProfile>(DEFAULT_PROFILE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        setProfile({ ...DEFAULT_PROFILE, ...p,
          interests: migrateInterests(p.interests), dislikes: migrateInterests(p.dislikes) });
      }
    } catch {}
    setLoaded(true);
  }, []);

  const save = (p: FamilyProfile) => {
    setProfile(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {}
  };

  return [profile, save, loaded];
}

// --- Hotels the user already booked (basis for a star-trip) ---
export type Hotel = {
  id: string;
  name: string;
  label: string;   // resolved full address
  city: string;
  country: string;
  lat: number;
  lng: number;
  checkIn?: string;
  checkOut?: string;
  tripId?: string | null;   // which trip this hotel belongs to (null = unassigned)
  segmentId?: string | null; // which leg of a multi-city trip (null = unassigned)
};

const HOTELS_KEY = "nanabanana.hotels.v1";
const HOTELS_EVT = "nanabanana:hotels";   // same-tab cross-instance change signal

export function useHotels(): {
  hotels: Hotel[];
  add: (h: Hotel) => void;
  remove: (id: string) => void;
  link: (id: string, tripId: string | null) => void;
  assign: (id: string, segmentId: string | null) => void;
  loaded: boolean;
} {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loaded, setLoaded] = useState(false);

  const read = (): Hotel[] => { try { const raw = localStorage.getItem(HOTELS_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; } };

  // Reactive across ALL useHotels() instances (map + add-form live in different
  // components): every write fires a custom event so each instance re-reads — the
  // hotel marker now appears on the map immediately, without a page refresh.
  useEffect(() => {
    setHotels(read());
    setLoaded(true);
    const sync = () => setHotels(read());
    window.addEventListener(HOTELS_EVT, sync);
    window.addEventListener("storage", sync);   // also cross-tab
    return () => { window.removeEventListener(HOTELS_EVT, sync); window.removeEventListener("storage", sync); };
  }, []);

  // Operate on the freshest localStorage (read()), not a possibly-stale closure,
  // then persist + broadcast so sibling instances update.
  const persist = (next: Hotel[]) => {
    setHotels(next);
    try { localStorage.setItem(HOTELS_KEY, JSON.stringify(next)); } catch {}
    try { window.dispatchEvent(new Event(HOTELS_EVT)); } catch {}
  };

  return {
    hotels,
    add: (h) => persist([...read(), h]),
    remove: (id) => persist(read().filter((x) => x.id !== id)),
    link: (id, tripId) => persist(read().map((x) => (x.id === id ? { ...x, tripId } : x))),
    assign: (id, segmentId) => persist(read().map((x) => (x.id === id ? { ...x, segmentId } : x))),
    loaded,
  };
}

// --- Trips: real, saved trip entities ---
export type TripMode = "preferences" | "hotels";

// One leg of a multi-city trip: a base city + how many days there.
export type Segment = {
  id: string;
  city: string;           // English — for attraction/API resolution
  cityHe?: string;        // Hebrew — for display
  country?: string;
  destinationId?: number;
  days: number;
};

export type Trip = {
  id: string;
  title: string;
  mode: TripMode;
  city?: string;          // English — used for attraction/API resolution
  cityHe?: string;        // Hebrew — for display
  country?: string;
  destinationId?: number;
  days: number;
  month: number;          // 1-12 — when the trip is (for seasonal relevance)
  startDate?: string;     // exact dates (ISO yyyy-mm-dd) — powers the events layer (#64)
  endDate?: string;
  segments?: Segment[];   // present (length ≥ 2) for multi-city trips
  profile?: FamilyProfile; // per-trip travelers — overrides the global profile
  packing?: {              // per-trip packing list state (#18)
    checked: string[];
    removed: string[];
    custom: { id: string; label: string }[];
  };
  checklist?: {            // per-trip pre-flight checklist state (#17)
    checked: string[];
    removed: string[];
    custom: { id: string; label: string }[];
  };
  budget?: { dailyTarget?: number }; // per-trip daily budget target, € (#15)
  selection?: {            // from the Explore flow: yes = anchors, no = excluded.
    yes: number[]; no: number[];
  };
  streetIds?: number[];    // recommended streets marked "כן" — each becomes a stop
  // Chosen-neighbourhood tour: one member-id array per area the traveller picked to
  // tour → the builder makes one guaranteed day per area.
  areaGroups?: number[][];
  // "כן" picks the last build couldn't fit — surfaced so the user can add them.
  // Carry the same detail fields a scheduled stop has, so a bank card can be
  // expanded and read before it's dragged into the day (everything but the time).
  leftOut?: { id: number; name_he: string | null; name_en: string; image_url: string | null; category: string; lat?: number | null; lng?: number | null; tagline_he?: string | null; tips_he?: string | null; best_time_he?: string | null; dress_he?: string | null; cost_level?: number | null; website?: string | null }[];
  itinerary?: Itinerary;
  engine?: string;         // how the current itinerary was built: "heuristic" | "neighbourhoods" | "ai"
  // Community sharing (phase 0+1): the public copy's slug + the owner token
  // that proves ownership (updates / marking comments as helpful).
  shared?: { slug: string; token: string };
  remixOf?: string;        // slug of the shared trip this one was copied from
  createdAt: number;
  updatedAt?: number;      // last time the trip was changed (stamped on every update)
};

export const MONTHS_HE = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

// From an exact date range → {days (inclusive), month} to keep the rest of the
// app (season, length) working off dates. (#64)
export function datesToInfo(startDate?: string, endDate?: string): { days: number; month: number } | null {
  if (!startDate || !endDate) return null;
  const a = new Date(startDate + "T00:00:00");
  const b = new Date(endDate + "T00:00:00");
  if (isNaN(+a) || isNaN(+b) || b < a) return null;
  const days = Math.round((+b - +a) / 86400000) + 1;
  return { days: Math.max(1, days), month: a.getMonth() + 1 };
}

// Map a month to a season label + the best_season enum value, for the AI.
export function monthSeason(month: number): { he: string; season: string } {
  if ([12, 1, 2].includes(month)) return { he: "חורף", season: "winter" };
  if ([3, 4, 5].includes(month)) return { he: "אביב", season: "spring" };
  if ([6, 7, 8].includes(month)) return { he: "קיץ", season: "summer" };
  return { he: "סתיו", season: "autumn" };
}

const TRIPS_KEY = "nanabanana.trips.v1";

const ANON_KEY = "nanabanana.anonuid";   // anon user id held across a login redirect

export function useTrips(): {
  trips: Trip[];
  create: (t: Omit<Trip, "id" | "createdAt">) => Trip;
  update: (id: string, patch: Partial<Trip>) => void;
  remove: (id: string) => void;
  loaded: boolean;
} {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { user } = useSessionUser();
  // refs so create/update/remove compute + push synchronously off the latest state
  const tripsRef = useRef<Trip[]>([]);
  const userIdRef = useRef<string | null>(null);

  // localStorage is the instant, offline-safe copy; server is the cross-device one.
  const applyLocal = (next: Trip[]) => {
    tripsRef.current = next;
    setTrips(next);
    try { localStorage.setItem(TRIPS_KEY, JSON.stringify(next)); } catch {}
  };

  // 1) hydrate from localStorage immediately (unchanged first paint)
  useEffect(() => {
    try { const raw = localStorage.getItem(TRIPS_KEY); if (raw) applyLocal(JSON.parse(raw)); } catch {}
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) once a session exists, sync with the server: adopt anon trips on first real
  //    login, then merge (last-write-wins per trip) and push local-newer up.
  useEffect(() => {
    if (!user) return;
    userIdRef.current = user.id;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isAnon = (user as any).is_anonymous === true;
      if (isAnon) {
        try { localStorage.setItem(ANON_KEY, user.id); } catch {}
      } else {
        // permanent user → fold in trips made under the earlier anon session
        let pending: string | null = null;
        try { pending = localStorage.getItem(ANON_KEY); } catch {}
        if (pending && pending !== user.id) {
          try {
            await fetch("/api/trips/adopt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fromUserId: pending }) });
          } catch {}
        }
        try { localStorage.removeItem(ANON_KEY); } catch {}
      }
      const server = await fetchServerTrips();
      if (cancelled) return;
      const { merged, toPush } = mergeTrips(tripsRef.current, server);
      applyLocal(merged);
      for (const t of toPush) upsertServerTrip(user.id, t);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return {
    trips,
    loaded,
    create: (t) => {
      const trip: Trip = { ...t, id: uid(), createdAt: Date.now(), updatedAt: Date.now() };
      applyLocal([trip, ...tripsRef.current]);
      if (userIdRef.current) upsertServerTrip(userIdRef.current, trip);
      return trip;
    },
    update: (id, patch) => {
      const cur = tripsRef.current.find((x) => x.id === id);
      if (!cur) return;
      const updated: Trip = { ...cur, ...patch, updatedAt: Date.now() };
      applyLocal(tripsRef.current.map((x) => (x.id === id ? updated : x)));
      if (userIdRef.current) upsertServerTrip(userIdRef.current, updated);
    },
    remove: (id) => {
      applyLocal(tripsRef.current.filter((x) => x.id !== id));
      if (userIdRef.current) deleteServerTrip(userIdRef.current, id);
    },
  };
}

// Per-city yes/maybe/no marks, kept per destination and persisted — the
// traveler's evolving "city profile". Any trip to that city inherits them, and
// the map feeds the itinerary builder (yes = anchors; no = excluded; unmarked =
// included only if it's a must-see or sits in a chosen neighbourhood).
export type Choice = "yes" | "no";
const CITYSEL_KEY = "nanabanana.citysel.v1";

export function useCitySelection(destinationId: number | null | undefined): {
  choices: Record<number, Choice>;
  setChoice: (attractionId: number, c: Choice) => void;
  setMany: (attractionIds: number[], c: Choice | null) => void;
  clear: () => void;
  loaded: boolean;
} {
  const [all, setAll] = useState<Record<string, Record<number, Choice>>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CITYSEL_KEY);
      if (raw) {
        // Migrate away the retired "maybe" state: an old "maybe" mark becomes
        // UNMARKED (not "no") — the builder treats it like any unmarked place.
        const parsed = JSON.parse(raw) as Record<string, Record<number, string>>;
        for (const city of Object.keys(parsed))
          for (const id of Object.keys(parsed[city]))
            if (parsed[city][Number(id)] === "maybe") delete parsed[city][Number(id)];
        setAll(parsed as Record<string, Record<number, Choice>>);
      }
    } catch {}
    setLoaded(true);
  }, []);
  // Functional updates so rapid marks on different cards never clobber each
  // other (each read sees the freshest state); localStorage is written inline.
  const commit = (updater: (prev: Record<string, Record<number, Choice>>) => Record<string, Record<number, Choice>>) =>
    setAll((prev) => {
      const next = updater(prev);
      try { localStorage.setItem(CITYSEL_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  const key = String(destinationId ?? "_");
  return {
    choices: all[key] ?? {},
    loaded,
    setChoice: (id, c) => commit((prev) => {
      const cur = { ...(prev[key] ?? {}) };
      if (cur[id] === c) delete cur[id]; else cur[id] = c;  // clicking the same choice clears it
      return { ...prev, [key]: cur };
    }),
    setMany: (ids, c) => commit((prev) => {
      const cur = { ...(prev[key] ?? {}) };
      for (const id of ids) { if (c === null) delete cur[id]; else cur[id] = c; }
      return { ...prev, [key]: cur };
    }),
    clear: () => commit((prev) => { const n = { ...prev }; delete n[key]; return n; }),
  };
}

// The traveller's כן/לא marks on recommended STREETS. Kept in its own store
// because street ids live in their own table and would collide with attraction
// ids if mixed into the same map.
const STREETSEL_KEY = "nanabanana.streetsel.v1";

export function useStreetSelection(destinationId: number | null | undefined): {
  choices: Record<number, Choice>;
  setChoice: (streetId: number, c: Choice) => void;
  clear: () => void;
  loaded: boolean;
} {
  const [all, setAll] = useState<Record<string, Record<number, Choice>>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STREETSEL_KEY);
      if (raw) setAll(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);
  const commit = (updater: (prev: Record<string, Record<number, Choice>>) => Record<string, Record<number, Choice>>) =>
    setAll((prev) => {
      const next = updater(prev);
      try { localStorage.setItem(STREETSEL_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  const key = String(destinationId ?? "_");
  return {
    choices: all[key] ?? {},
    loaded,
    setChoice: (id, c) => commit((prev) => {
      const cur = { ...(prev[key] ?? {}) };
      if (cur[id] === c) delete cur[id]; else cur[id] = c;
      return { ...prev, [key]: cur };
    }),
    clear: () => commit((prev) => { const n = { ...prev }; delete n[key]; return n; }),
  };
}

// Read a single trip by id outside React (e.g. on the trip page initial load).
export function readTrip(id: string): Trip | null {
  try {
    const raw = localStorage.getItem(TRIPS_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as Trip[]).find((t) => t.id === id) ?? null;
  } catch {
    return null;
  }
}

export function profileSummary(p: FamilyProfile): string {
  const kids = p.kids.length
    ? `${p.kids.length} ילדים (${p.kids.map((k) => k.age).join(", ")})`
    : "בלי ילדים";
  return `${p.adults} מבוגרים · ${kids}`;
}

// Rich Hebrew description of the family — fed to Claude so trips are personalized.
export function profileText(p: FamilyProfile): string {
  const lines = [`${p.adults} מבוגרים`];
  if (p.kids.length) {
    lines.push(
      "ילדים: " +
        p.kids
          .map((k) => `${k.name || "ילד"} בן ${k.age}${k.loves ? ` (אוהב ${k.loves})` : ""}`)
          .join(", ")
    );
  } else {
    lines.push("ללא ילדים");
  }
  if (p.interests.length) lines.push("אוהבים: " + p.interests.join(", "));
  if (p.dislikes.length) lines.push("פחות אוהבים: " + p.dislikes.join(", "));
  lines.push(`קצב ${p.pace}`, `תקציב ${p.budget}`,
    `עד ${p.dailyDriveHours} שעות נסיעה לכל כיוון מבסיס הלינה (רדיוס לטיולי-יום)`, `לינה: ${p.lodging}`);
  if (p.accessibility?.length)
    lines.push("נגישות (חובה להתחשב — העדף מקומות נגישים ללא מדרגות מיותרות): " + p.accessibility.join(", "));
  if (p.dietary?.length)
    lines.push("תזונה (ציין/העדף אפשרויות מתאימות ליד עצירות אוכל): " + p.dietary.join(", "));
  return lines.join(" · ");
}

// --- Follows (#65): who/what the traveler tracks → ⭐ boosts in the events feed.
// User-level (not per-trip): you follow Metallica / Arsenal regardless of city.
export type Follows = {
  artists: string[];       // "Metallica" → concerts
  teams: string[];         // "Arsenal" → matches
  observances: string[];   // "גאווה", "חג המולד", "יום האהבה" → dated city events
};
export const DEFAULT_FOLLOWS: Follows = { artists: [], teams: [], observances: [] };
const FOLLOWS_KEY = "nanabanana.follows.v1";

export function useFollows(): [Follows, (f: Follows) => void, boolean] {
  const [follows, setFollows] = useState<Follows>(DEFAULT_FOLLOWS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FOLLOWS_KEY);
      if (raw) setFollows({ ...DEFAULT_FOLLOWS, ...JSON.parse(raw) });
    } catch {}
    setLoaded(true);
  }, []);
  const save = (f: Follows) => {
    setFollows(f);
    try { localStorage.setItem(FOLLOWS_KEY, JSON.stringify(f)); } catch {}
  };
  return [follows, save, loaded];
}
