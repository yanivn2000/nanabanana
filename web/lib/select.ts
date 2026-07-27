// Trip SELECTION — the pure, deterministic core that decides WHICH attractions make
// the trip (diversity floor + theme budget + per-category balance caps), independent
// of any DB or scheduling. Extracted from the build route so BOTH the server build
// and a live client-side funnel preview run the exact same logic (single source of
// truth — the preview can never drift from the real trip's selection).
//
// It does NOT do proximity clustering, timing, nightlife-evening placement or detail
// attachment — those stay in the heuristic (server). This is only "what's in the pool
// and in what priority", which is what a funnel preview needs.
import type { Attraction } from "./db";
import { interestTasteMap, INTEREST_KEYWORDS, tasteScore, coarseFits } from "./taste";

// Each governing interest → the DB category bucket(s) it emphasises. Drives the
// diversity floor + balance caps. "attraction" is a catch-all where many cities file
// monuments/landmarks (Lisbon), so history/architecture claim it too.
export const INTEREST_CAT_BUCKETS: Record<string, string[]> = {
  "מוזיאונים": ["museum"], "אוכל": ["food", "shopping"], "טבע": ["nature"],
  "חיי לילה": ["food"], "היסטוריה": ["historic", "attraction"], "אדריכלות": ["historic", "attraction"],
  "וינטג'": ["shopping"], "פארקי שעשועים": ["nature"], "חופים": ["nature"],
};
export const catBucket = (a: Attraction) => (a.category === "tourism" ? "historic" : (a.category ?? "attraction"));

export type SelectInput = {
  attractions: Attraction[];    // ranked + reach-filtered pool (already kid-filtered for adults)
  base: Attraction[];           // DB icon order (EDITOR_ORDER: effective must-see first)
  interestRows: Attraction[];   // thin-interest injected venues (nightlife / niche shops)
  interests: string[];
  days: number;
  perDay: number;
  pickIds: number[];
  areaMemberIds: number[];
  areaGroupsLen: number;        // number of chosen neighbourhoods
};
export type SelectOutput = {
  orderedFill: Attraction[];
  reservedIds: Set<number>;
  guaranteeIds: Set<number>;    // chosen-theme stops the clusterer may drop (scattered)
};

export function selectTrip(inp: SelectInput): SelectOutput {
  const { attractions, base, interestRows, interests, days: rDays, perDay, pickIds, areaMemberIds, areaGroupsLen } = inp;
  const RESERVE_ICONS = Math.max(3, rDays);
  // THEME BUDGET: ~2 themed stops/day, SPLIT across chosen interests (fewer interests
  // = deeper focus on each; overlap with must-sees fills the icon backbone too).
  const themeBudget = 2 * rDays;
  const perInterest = interests.length ? Math.max(1, Math.round(themeBudget / interests.length)) : 0;
  const chosenCats = new Set(interests.flatMap((it) => INTEREST_CAT_BUCKETS[it] ?? []));
  const inRange = new Set(attractions.map((a) => a.id));
  const chosen = new Set<number>();
  const reserved: Attraction[] = [];
  // Explicit ❤ likes lead the reservation (guaranteed in, cap-exempt below).
  const pickSet = new Set(pickIds);
  for (const a of attractions.filter((x) => pickSet.has(x.id))) {
    if (!chosen.has(a.id)) { chosen.add(a.id); reserved.push(a); }
  }
  // Icons from DB icon order (effective must-see first), in-range only.
  for (const a of base.filter((x) => x.must_see === 1 && inRange.has(x.id)).slice(0, RESERVE_ICONS)) {
    if (!chosen.has(a.id)) { chosen.add(a.id); reserved.push(a); }
  }
  // Additive neighbourhoods: reserve the chosen areas' members (must-sees first).
  if (areaMemberIds.length && areaGroupsLen) {
    const areaSet = new Set(areaMemberIds);
    const mem = attractions.filter((a) => areaSet.has(a.id));
    const areaOrdered = [...mem.filter((a) => a.must_see === 1), ...mem.filter((a) => a.must_see !== 1)];
    const budget = (perDay + 1) * areaGroupsLen;
    let cnt = 0;
    for (const a of areaOrdered) {
      if (cnt >= budget) break;
      if (!chosen.has(a.id)) { chosen.add(a.id); reserved.push(a); cnt++; }
    }
  }
  // Theme guarantee: up to perInterest matching stops per chosen interest (taste-tag /
  // coarse category / name keyword). interestRows (quality-ordered thin venues) first.
  const themeIds = new Set<number>();
  for (const it of interests) {
    const w = interestTasteMap(it), kws = INTEREST_KEYWORDS[it] ?? [];
    let k = 0;
    for (const a of [...interestRows, ...attractions]) {
      if (k >= perInterest) break;
      if (chosen.has(a.id)) continue;
      const nm = a.name_he || a.name_en || "";
      const match = (a.taste_tags && tasteScore(a.taste_tags, w) > 0)
        || coarseFits(a.category, a.subcategory, [it])
        || kws.some((kw) => nm.includes(kw));
      if (match) { chosen.add(a.id); reserved.push(a); themeIds.add(a.id); k++; }
    }
  }
  // DIVERSITY FLOOR: ~1 of each MAJOR category NOT chosen, so no trip is one-note.
  const MAJOR = ["nature", "museum", "historic", "food"];
  for (const cat of MAJOR) {
    if (chosenCats.has(cat)) continue;
    const a = attractions.find((x) => !chosen.has(x.id) && catBucket(x) === cat);
    if (a) { chosen.add(a.id); reserved.push(a); }
  }
  // Keep the whole reserved backbone up to capacity; the capped fill tops it up.
  const capReserve = areaMemberIds.length
    ? Math.min(reserved.length, Math.round(rDays * perDay * 0.85))
    : Math.min(rDays * perDay, reserved.length);
  const front = reserved.slice(0, capReserve);
  const frontIds = new Set(front.map((a) => a.id));
  // PER-CATEGORY BALANCE CAP on the fill: soft cap (chosen ≈2×days split by chosen
  // cat count / others ≈days/2), hard ceiling as a FRACTION of trip size (chosen ~50%,
  // other ~30%) so a dense catch-all never out-weighs the theme.
  const nCats = Math.max(1, chosenCats.size);
  const capChosen = Math.min(2 * rDays, Math.round((2 * rDays) / nCats) + 1);
  const capOther = Math.max(1, Math.round(rDays / 2));
  const cap = rDays * perDay;
  const capHardChosen = Math.max(capChosen, Math.round(cap * 0.5));
  const capHardOther = Math.max(capOther + 1, Math.round(cap * 0.3));
  const catN = new Map<string, number>();
  for (const a of front) { const c = catBucket(a); catN.set(c, (catN.get(c) ?? 0) + 1); }
  const capped: Attraction[] = [], overflow: Attraction[] = [];
  for (const a of attractions) {
    if (frontIds.has(a.id)) continue;
    const c = catBucket(a);
    const isCat = chosenCats.has(c);
    const lim = isCat ? capChosen : capOther;
    const hard = isCat ? capHardChosen : capHardOther;
    const cur = catN.get(c) ?? 0;
    if (pickSet.has(a.id) || cur < lim) { catN.set(c, cur + 1); capped.push(a); }
    else if (cur < hard) { catN.set(c, cur + 1); overflow.push(a); }
    // else: over the absolute ceiling — dropped.
  }
  return { orderedFill: [...front, ...capped, ...overflow], reservedIds: new Set(frontIds), guaranteeIds: themeIds };
}
