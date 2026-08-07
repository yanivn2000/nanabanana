"use client";

// Product analytics, first-party and deliberately small.
//
// Vercel Analytics already answers "how many people, from where, on what". This
// answers the question it cannot: what did they DO. Four events carry almost all
// of it — saw a city, started a build, finished a build, searched for a city we
// do not have — and every one of them maps to a decision we actually make
// (which destination to add next, where the funnel leaks).
//
// No personal data: the client id is the random string the trip store already
// uses to keep a device's trips together, and nothing else about the visitor is
// recorded. Failures are silent — analytics must never break a page.

export type EventName =
  | "city_view"        // { slug }
  | "build_started"    // { slug, days, kids, picks, interests }
  | "build_done"       // { slug, days, stops, ms }
  | "search_miss"      // { q } — typed on the home search, matched no destination
  | "trip_shared";     // { slug }

const CLIENT_KEY = "nanabanana.client.v1";

function clientId(): string | null {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return null;   // private mode / storage disabled — the event still counts
  }
}

export function track(name: EventName, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    name, props, clientId: clientId(), path: window.location.pathname,
  });
  try {
    // sendBeacon survives the page unloading — a build that navigates away still
    // reports. fetch with keepalive is the fallback for browsers without it.
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/ev", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/ev", { method: "POST", body, keepalive: true,
      headers: { "Content-Type": "application/json" } });
  } catch {
    /* never break the page for a metric */
  }
}
