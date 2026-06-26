"use client";

import { useEffect, useState } from "react";

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

export function profileSummary(p: FamilyProfile): string {
  const kids = p.kids.length
    ? `${p.kids.length} ילדים (${p.kids.map((k) => k.age).join(", ")})`
    : "בלי ילדים";
  return `${p.adults} מבוגרים · ${kids}`;
}
