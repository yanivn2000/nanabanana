// Deterministic trip revision — the FREE, no-AI path for editing a trip. Handles the
// quick-action chips + common Hebrew intents by transforming the CURRENT itinerary in
// place (drop / add / shorten / swap), then re-timing the affected days with the same
// dwell + walk model as the builder. Anything it doesn't recognise is BLOCKED (the
// trip returns unchanged with a note) — no Claude call is ever made from here.
import type { Attraction } from "./db";
import type { Itinerary, Day, Stop, StopKind } from "./trip-types";
import { dwellMinutes, DWELL_DEFAULT } from "./brain/traits";
import { haversineKm, walkMinutes, durationHe } from "./geo";

const DAY_START = 9 * 60 + 30, LUNCH_AFTER = 12 * 60, LUNCH_MIN = 60;
const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const KIND: Record<string, StopKind> = { nature: "nature", museum: "culture", attraction: "culture", historic: "culture", tourism: "culture", food: "food", shopping: "shopping", leisure: "nature", sport: "nature" };
const attrWorth = (a: Attraction) => (a.must_see === 1 ? 1000 : 0) + Math.max(a.audience_fit?.families ?? 0, a.audience_fit?.couples ?? 0, a.audience_fit?.friends ?? 0);
const attrToStop = (a: Attraction): Stop => ({ name: a.name_he || a.name_en, kind: KIND[a.category] ?? "culture", time: "", duration: "", id: a.id, lat: a.lat, lng: a.lng, image: a.image_url, tagline: a.tagline_he, note: a.tips_he || a.tagline_he || undefined });

export type ReviseResult = { itinerary: Itinerary; changed: boolean; note?: string };

// Re-time one day sequentially (start 09:30, dwell per stop, walk between, lunch after
// noon) — mirrors the builder so edited days stay consistent.
function retime(day: Day, dwellOf: (s: Stop) => number): void {
  const content = day.stops.filter((s) => s.kind !== "food");
  let clock = DAY_START, lunchDone = false;
  const out: Stop[] = [];
  content.forEach((s, i) => {
    if (!lunchDone && i > 0 && clock >= LUNCH_AFTER) {
      out.push({ name: "הפסקת צהריים", kind: "food", time: fmt(clock), duration: durationHe(LUNCH_MIN), note: "מסעדה מקומית באזור" });
      clock += LUNCH_MIN; lunchDone = true;
    }
    const dw = dwellOf(s);
    out.push({ ...s, time: fmt(clock), duration: durationHe(dw) });
    clock += dw;
    const nx = content[i + 1];
    if (nx && s.lat != null && nx.lat != null) clock += walkMinutes(haversineKm(s.lat, s.lng as number, nx.lat, nx.lng as number));
  });
  day.stops = out;
}

// Nearest-neighbour order for an arbitrary set of stops (keeps coord-less ones last).
function orderNN(stops: Stop[]): Stop[] {
  const pts = stops.filter((s) => s.lat != null && s.lng != null);
  const noc = stops.filter((s) => s.lat == null || s.lng == null);
  if (pts.length <= 2) return [...pts, ...noc];
  const out = [pts[0]]; const rest = pts.slice(1);
  while (rest.length) {
    const cur = out[out.length - 1];
    let bi = 0, bd = Infinity;
    rest.forEach((s, i) => { const d = haversineKm(cur.lat as number, cur.lng as number, s.lat as number, s.lng as number); if (d < bd) { bd = d; bi = i; } });
    out.push(rest.splice(bi, 1)[0]);
  }
  return [...out, ...noc];
}

// STRUCTURED per-day rebuild — the map "סדר את היום" action. Takes explicit add/remove
// attraction ids for ONE day, applies them, re-orders (nearest-neighbour) and re-times.
// No text parsing, no AI — purely deterministic.
export function arrangeDay(current: Itinerary, dayIndex: number, addIds: number[], removeIds: number[], pool: Attraction[]): ReviseResult {
  const day = current.days[dayIndex];
  if (!day) return { itinerary: current, changed: false };
  const byId = new Map(pool.filter((a) => a.id != null).map((a) => [a.id, a]));
  const remove = new Set(removeIds);
  let stops = day.stops.filter((s) => s.kind !== "food" && !(s.id != null && remove.has(s.id)));
  const present = new Set(stops.map((s) => s.id).filter((x): x is number => x != null));
  for (const id of addIds) {
    if (present.has(id)) continue;
    const a = byId.get(id);
    if (a && a.lat != null && a.lng != null) { stops.push(attrToStop(a)); present.add(id); }
  }
  stops = orderNN(stops);
  const dwellOf = (s: Stop) => { const a = s.id != null ? byId.get(s.id) : undefined; return a ? dwellMinutes(a, DWELL_DEFAULT) : 50; };
  const days = current.days.map((d, i) => (i === dayIndex ? { ...d, stops: [...stops] } : d));
  retime(days[dayIndex], dwellOf);
  return { itinerary: { ...current, days }, changed: true };
}

export function reviseHeuristic(current: Itinerary, instruction: string, pool: Attraction[]): ReviseResult {
  const byId = new Map(pool.filter((a) => a.id != null).map((a) => [a.id, a]));
  const worth = (s: Stop) => { const a = s.id != null ? byId.get(s.id) : undefined; return a ? attrWorth(a) : (s.score ?? 0); };
  const dwellOf = (s: Stop) => { const a = s.id != null ? byId.get(s.id) : undefined; return a ? dwellMinutes(a, DWELL_DEFAULT) : 50; };
  const t = instruction;

  // scope: "יום N" → that day only; else the whole trip
  const dm = t.match(/יום\s*(\d+)/);
  const scope = dm ? [Number(dm[1]) - 1] : current.days.map((_, i) => i);

  const days: Day[] = current.days.map((d) => ({ ...d, stops: [...d.stops] }));
  let changed = false;

  const lighten = /פחות עצירות|זמן חופשי|נינוח|רגוע|להאט|יותר פנאי|פחות אטרקציות/.test(t);
  const intensify = /אינטנסיבי|למצות|יותר עצירות|צפוף|יותר לראות|יותר אטרקציות/.test(t);
  const shorten = /לקצר|קצר את|נגמר העניין|מותש|עייפ/.test(t);
  const rain = /גשם|מקורה|מקורות|מזג.?האוויר|מזג.?אוויר/.test(t);
  const addM = t.match(/(?:הוסף|תוסיף)\s*(?:את\s*)?["']?([^"'\n]{2,40}?)["']?(?:\s+ליום.*)?$/);
  const remM = t.match(/(?:הסר|הורד|תוריד|בלי)\s*(?:את\s*)?["']?([^"'\n]{2,40}?)["']?(?:\s+מיום.*)?$/);
  const usedIds = () => new Set(days.flatMap((d) => d.stops.map((s) => s.id).filter((x): x is number => x != null)));

  for (const di of scope) {
    const day = days[di]; if (!day) continue;
    let content = day.stops.filter((s) => s.kind !== "food");
    if (rain && content.some((s) => s.kind === "nature") && content.filter((s) => s.kind !== "nature").length >= 1) {
      day.stops = day.stops.filter((s) => s.kind !== "nature"); changed = true; content = day.stops.filter((s) => s.kind !== "food");
    }
    if (lighten && content.length > 2) {
      const lo = content.reduce((a, b) => (worth(b) < worth(a) ? b : a));
      day.stops = day.stops.filter((s) => s !== lo); changed = true; content = day.stops.filter((s) => s.kind !== "food");
    }
    if (shorten && content.length > 1) {
      const last = content[content.length - 1];
      day.stops = day.stops.filter((s) => s !== last); changed = true; content = day.stops.filter((s) => s.kind !== "food");
    }
    if (intensify) {
      const used = usedIds();
      const cLat = content.reduce((s, x) => s + (x.lat ?? 0), 0) / (content.length || 1);
      const cLng = content.reduce((s, x) => s + (x.lng ?? 0), 0) / (content.length || 1);
      const cand = pool.filter((a) => a.id != null && !used.has(a.id) && a.lat != null && a.lng != null)
        .map((a) => ({ a, d: haversineKm(cLat, cLng, a.lat as number, a.lng as number), w: attrWorth(a) }))
        .filter((x) => x.d <= 2.5).sort((x, y) => y.w - x.w)[0];
      if (cand) { day.stops.push(attrToStop(cand.a)); changed = true; }
    }
  }

  const addName = addM && !intensify && !lighten ? (addM[1] || "").trim() : "";
  if (addName.length >= 2) {
    const used = usedIds();
    const found = pool.find((a) => a.id != null && !used.has(a.id) && (a.name_he || a.name_en || "").includes(addName));
    if (found && found.lat != null) {
      let best = 0, bd = Infinity;
      days.forEach((d, i) => { const c = d.stops.filter((s) => s.lat != null); if (!c.length) return;
        const cl = c.reduce((s, x) => s + (x.lat as number), 0) / c.length, cg = c.reduce((s, x) => s + (x.lng as number), 0) / c.length;
        const dist = haversineKm(cl, cg, found.lat as number, found.lng as number); if (dist < bd) { bd = dist; best = i; } });
      days[best].stops.push(attrToStop(found)); changed = true;
    }
  }
  const remName = remM && !shorten && !lighten ? (remM[1] || "").trim() : "";
  if (remName.length >= 2) {
    for (const d of days) { const n = d.stops.length; d.stops = d.stops.filter((s) => !(s.name || "").includes(remName)); if (d.stops.length !== n) changed = true; }
  }

  if (!changed) return { itinerary: current, changed: false,
    note: "העריכה החופשית עדיין לא נתמכת — נסו את הכפתורים המהירים (פחות/יותר עצירות · יום רגוע · יום קצר), או 'הוסף/הסר <שם מקום>'." };

  for (const d of days) retime(d, dwellOf);   // re-time all days so times stay consistent
  return { itinerary: { ...current, days }, changed: true };
}
