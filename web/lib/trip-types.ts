// Shared trip types — used by client components and the server AI layer.

export type StopKind = "nature" | "food" | "culture" | "rest" | "shopping";

export type Stop = {
  name: string;
  kind: StopKind;
  time: string;
  duration: string;
  score?: number;
  note?: string;
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
