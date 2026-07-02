import type { FamilyProfile } from "./store";
import type { Itinerary } from "./trip-types";

// Rough per-person ENTRY price (€) by cost_level 0..3 — adults, and kids (~60%).
// These are estimates keyed off each attraction's enriched price band, not real
// ticket prices, so the UI labels the result clearly as an estimate.
const ENTRY_ADULT = [0, 8, 18, 35];
const ENTRY_KID = [0, 5, 11, 21];
// Daily food + local-transport allowance per adult-equivalent (€), by budget style.
const ALLOWANCE: Record<string, number> = { "חסכוני": 40, "בינוני": 70, "מפנק": 120 };

export type DayCost = { label: string; entries: number; allowance: number; total: number };
export type BudgetEstimate = {
  adults: number; kids: number;
  perDay: DayCost[];
  entriesTotal: number; allowanceTotal: number; total: number;
  avgDaily: number;
};

export function estimateItinerary(it: Itinerary | null | undefined, p: FamilyProfile): BudgetEstimate {
  const adults = p.adults ?? 0;
  const kids = p.kids?.length ?? 0;
  const allowancePerDay = (ALLOWANCE[p.budget] ?? 70) * (adults + 0.6 * kids);

  const perDay: DayCost[] = (it?.days ?? []).map((d, i) => {
    let entries = 0;
    for (const s of d.stops) {
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
    adults, kids, perDay, entriesTotal, allowanceTotal, total,
    avgDaily: perDay.length ? Math.round(total / perDay.length) : 0,
  };
}
