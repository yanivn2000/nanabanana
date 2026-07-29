import type { FamilyProfile } from "./store";
import type { Itinerary } from "./trip-types";

// Rough per-person ENTRY price (€) by cost_level 0..3 — adults, and kids (~60%).
// These are estimates keyed off each attraction's enriched price band, not real
// ticket prices, so the UI labels the result clearly as an estimate.
export const ENTRY_ADULT = [0, 8, 18, 35];
export const ENTRY_KID = [0, 5, 11, 21];
// Daily food + local-transport allowance per adult-equivalent (€), split into the
// three meals + local transport, by budget style. Each column sums to the old flat
// allowance (חסכוני 40 · בינוני 70 · מפנק 120), so the headline total is unchanged —
// the split just makes the "אוכל ותחבורה" number legible instead of one lump.
export type AllowanceParts = { breakfast: number; lunch: number; dinner: number; transport: number };
const ALLOWANCE_PARTS: Record<string, AllowanceParts> = {
  "חסכוני": { breakfast: 6, lunch: 10, dinner: 16, transport: 8 },   // = 40
  "בינוני": { breakfast: 10, lunch: 18, dinner: 30, transport: 12 }, // = 70
  "מפנק": { breakfast: 18, lunch: 32, dinner: 50, transport: 20 },   // = 120
};
const partsFor = (budget: string): AllowanceParts => ALLOWANCE_PARTS[budget] ?? ALLOWANCE_PARTS["בינוני"];
const partsSum = (a: AllowanceParts) => a.breakfast + a.lunch + a.dinner + a.transport;

// Per-person ENTRY estimate for a single stop (€). A manual place carries its own
// exact price (priceEur); an attraction uses its enriched band. null = unknown/none.
export function stopEntryPerPerson(s: { cost?: number | null; priceEur?: number | null }): number | null {
  if (s.priceEur != null) return s.priceEur;
  if (s.cost != null) return ENTRY_ADULT[s.cost] ?? null;
  return null;
}

export type DayCost = { label: string; entries: number; allowance: number; total: number };
export type BudgetEstimate = {
  adults: number; kids: number; adultEquiv: number;
  perDay: DayCost[];
  entriesTotal: number; allowanceTotal: number; total: number;
  avgDaily: number;
  // Daily food + transport, broken down for the WHOLE party (part × adult-equivalent).
  allowanceParts: AllowanceParts;
};

export function estimateItinerary(it: Itinerary | null | undefined, p: FamilyProfile): BudgetEstimate {
  const adults = p.adults ?? 0;
  const kids = p.kids?.length ?? 0;
  const adultEquiv = adults + 0.6 * kids;
  const parts = partsFor(p.budget);
  const allowancePerDay = partsSum(parts) * adultEquiv;
  // party-level daily breakdown (each meal/transport × adult-equivalent)
  const allowanceParts: AllowanceParts = {
    breakfast: Math.round(parts.breakfast * adultEquiv),
    lunch: Math.round(parts.lunch * adultEquiv),
    dinner: Math.round(parts.dinner * adultEquiv),
    transport: Math.round(parts.transport * adultEquiv),
  };

  const perDay: DayCost[] = (it?.days ?? []).map((d, i) => {
    let entries = 0;
    for (const s of d.stops) {
      if (s.priceEur != null) {
        // a manual place with a known price — everyone in the party pays it
        entries += s.priceEur * (adults + kids);
        continue;
      }
      const c = s.cost;
      if (c == null) continue;
      entries += (ENTRY_ADULT[c] ?? 0) * adults + (ENTRY_KID[c] ?? 0) * kids;
    }
    return {
      label: d.label || `יום ${i + 1}`,
      entries: Math.round(entries),
      allowance: Math.round(allowancePerDay),
      total: Math.round(entries + allowancePerDay),
    };
  });

  const entriesTotal = perDay.reduce((a, d) => a + d.entries, 0);
  const allowanceTotal = perDay.reduce((a, d) => a + d.allowance, 0);
  const total = entriesTotal + allowanceTotal;
  return {
    adults, kids, adultEquiv, perDay, entriesTotal, allowanceTotal, total,
    avgDaily: perDay.length ? Math.round(total / perDay.length) : 0,
    allowanceParts,
  };
}
