"use client";

import { useEffect, useState } from "react";
import type { Itinerary } from "./trip-types";

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
};

export const DEFAULT_PROFILE: FamilyProfile = {
  adults: 2,
  kids: [],
  interests: ["טבע"],
  dislikes: [],
  pace: "בינוני",
  budget: "בינוני",
  dailyDriveHours: 1,
  lodging: "מלון",
  accessibility: [],
  dietary: [],
};

const KEY = "nanabanana.profile.v1";

// localStorage-backed state. SSR-safe (starts from default, hydrates on mount).
export function useProfile(): [FamilyProfile, (p: FamilyProfile) => void, boolean] {
  const [profile, setProfile] = useState<FamilyProfile>(DEFAULT_PROFILE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setProfile({ ...DEFAULT_PROFILE, ...JSON.parse(raw) });
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HOTELS_KEY);
      if (raw) setHotels(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);

  const persist = (next: Hotel[]) => {
    setHotels(next);
    try {
      localStorage.setItem(HOTELS_KEY, JSON.stringify(next));
    } catch {}
  };

  return {
    hotels,
    add: (h) => persist([...hotels, h]),
    remove: (id) => persist(hotels.filter((x) => x.id !== id)),
    link: (id, tripId) =>
      persist(hotels.map((x) => (x.id === id ? { ...x, tripId } : x))),
    assign: (id, segmentId) =>
      persist(hotels.map((x) => (x.id === id ? { ...x, segmentId } : x))),
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
  itinerary?: Itinerary;
  createdAt: number;
};

export const MONTHS_HE = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

// Map a month to a season label + the best_season enum value, for the AI.
export function monthSeason(month: number): { he: string; season: string } {
  if ([12, 1, 2].includes(month)) return { he: "חורף", season: "winter" };
  if ([3, 4, 5].includes(month)) return { he: "אביב", season: "spring" };
  if ([6, 7, 8].includes(month)) return { he: "קיץ", season: "summer" };
  return { he: "סתיו", season: "autumn" };
}

const TRIPS_KEY = "nanabanana.trips.v1";

export function useTrips(): {
  trips: Trip[];
  create: (t: Omit<Trip, "id" | "createdAt">) => Trip;
  update: (id: string, patch: Partial<Trip>) => void;
  remove: (id: string) => void;
  loaded: boolean;
} {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TRIPS_KEY);
      if (raw) setTrips(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);

  const persist = (next: Trip[]) => {
    setTrips(next);
    try {
      localStorage.setItem(TRIPS_KEY, JSON.stringify(next));
    } catch {}
  };

  return {
    trips,
    create: (t) => {
      const trip: Trip = { ...t, id: uid(), createdAt: Date.now() };
      persist([trip, ...trips]);
      return trip;
    },
    update: (id, patch) =>
      persist(trips.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    remove: (id) => persist(trips.filter((x) => x.id !== id)),
    loaded,
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
