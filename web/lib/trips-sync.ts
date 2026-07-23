"use client";

// Server sync for trips — thin wrappers over the Supabase browser client, scoped
// by RLS (auth.uid() = user_id), so no CRUD API routes are needed. Everything is
// best-effort: a failure never throws (the app keeps its localStorage copy).
import { createClient } from "@/lib/supabase/client";
import type { Trip } from "./store";

const stamp = (t: Trip) => t.updatedAt ?? t.createdAt ?? 0;

// All of the current user's trips (the whole Trip object lives in `data`).
export async function fetchServerTrips(): Promise<Trip[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.from("trips").select("data");
    if (error || !data) return [];
    return (data as { data: Trip }[]).map((r) => r.data).filter(Boolean);
  } catch {
    return [];
  }
}

export async function upsertServerTrip(userId: string, trip: Trip): Promise<void> {
  try {
    const supabase = createClient();
    await supabase.from("trips").upsert(
      {
        user_id: userId,
        client_id: trip.id,
        data: trip,
        updated_at: new Date(stamp(trip) || Date.now()).toISOString(),
      },
      { onConflict: "user_id,client_id" }
    );
  } catch { /* keep local copy */ }
}

export async function deleteServerTrip(userId: string, clientId: string): Promise<void> {
  try {
    const supabase = createClient();
    await supabase.from("trips").delete().eq("user_id", userId).eq("client_id", clientId);
  } catch { /* keep local copy */ }
}

// Merge local + server by client id, newest `updatedAt` wins (last-write-wins per
// trip). Returns the merged list and the subset that is local-only or locally
// newer (to push up to the server).
export function mergeTrips(local: Trip[], server: Trip[]): { merged: Trip[]; toPush: Trip[] } {
  const byId = new Map<string, Trip>();
  for (const t of server) byId.set(t.id, t);
  const toPush: Trip[] = [];
  for (const t of local) {
    const s = byId.get(t.id);
    if (!s || stamp(t) > stamp(s)) { byId.set(t.id, t); toPush.push(t); }
  }
  // newest first, matching create()'s prepend order
  const merged = [...byId.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return { merged, toPush };
}
