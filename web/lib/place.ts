// Place identity across the THREE kinds of thing a route visits: a point
// (attraction), a line (street/canal), and — later — a zone (neighbourhood).
//
// Canonical identity is a tagged string `PlaceRef` ("attr:123" | "street:4" |
// "zone:12"): unique across kinds, self-describing, and open to a 4th kind with
// no id-space juggling.
//
// The planner (clusterIntoDays / heuristic) keys everything on a NUMERIC id in
// Set<number>/Map<number>. To avoid rewriting all of that to strings, each kind
// owns a numeric RANGE. Real attractions are small serials (< 1e9), so they map
// 1:1. Synthetic stops (a street) sit in their own range — replacing the old
// "negative id = street" hack, which encoded the kind in a sign (fragile, and it
// leaked a bad id into attraction_edges' FK).

export type PlaceKind = "attr" | "street" | "zone";
export type PlaceRef = `${PlaceKind}:${number}`;

export const refOf = (kind: PlaceKind, id: number): PlaceRef => `${kind}:${id}`;
export function parseRef(r: PlaceRef): { kind: PlaceKind; id: number } {
  const i = r.indexOf(":");
  return { kind: r.slice(0, i) as PlaceKind, id: Number(r.slice(i + 1)) };
}

// Numeric-id ranges, one per kind. Real attraction ids are far below STREET_BASE.
const STREET_BASE = 1_000_000_000;
const ZONE_BASE = 2_000_000_000;
const BASE: Record<PlaceKind, number> = { attr: 0, street: STREET_BASE, zone: ZONE_BASE };

// PlaceRef → the numeric id the planner keys on.
export const synthId = (kind: PlaceKind, id: number): number => BASE[kind] + id;

// numeric id → which kind it belongs to (by range).
export function idKind(id: number): PlaceKind {
  if (id >= ZONE_BASE) return "zone";
  if (id >= STREET_BASE) return "street";
  return "attr";
}
// numeric id → its canonical ref (inverse of synthId).
export function refFromId(id: number): PlaceRef {
  const kind = idKind(id);
  return refOf(kind, id - BASE[kind]);
}
// true for anything that is NOT a real DB attraction (so we never write it to an
// attractions-keyed table like attraction_edges).
export const isRealAttraction = (id: number): boolean => idKind(id) === "attr";
