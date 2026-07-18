import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Reliable insight→attraction matching. The old token-only matcher produced
// false positives ("שוק אלברט" → an "Albert" statue) and false negatives
// (Hebrew transliteration "הייניקן" never matched "Heineken"). This is a
// hybrid: a fuzzy character+token SHORTLIST surfaces plausible candidates
// (transliteration-tolerant), then Claude RESOLVES — picking the one true
// attraction or rejecting non-attractions (shops, hotels, day-trips, the city
// itself). Matching runs at ingest and in bulk re-match; never at read time.

export type MatchAttraction = { id: number; name_en: string; name_he: string | null };

// ---- text utilities (pure, unit-testable) ----------------------------------
export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .split("")
    .filter((ch) => /[\p{L}\p{N}\s]/u.test(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
export function tokens(s: string | null | undefined): Set<string> {
  return new Set(norm(s).split(/\s+/).filter((t) => t.length >= 2));
}
function bigrams(s: string): Set<string> {
  const n = norm(s).replace(/\s+/g, "");
  const g = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) g.add(n.slice(i, i + 2));
  return g;
}
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// blended fuzzy similarity between a place name and one attraction name
function nameScore(placeNorm: string, pTok: Set<string>, pBi: Set<string>, name: string): number {
  const nN = norm(name);
  if (!nN) return 0;
  if (nN === placeNorm) return 1; // exact
  const tok = jaccard(pTok, tokens(name));
  const bi = dice(pBi, bigrams(name));
  const sub = nN.includes(placeNorm) || placeNorm.includes(nN)
    ? Math.min(nN.length, placeNorm.length) / Math.max(nN.length, placeNorm.length)
    : 0;
  return Math.max(tok, bi * 0.95, sub * 0.9);
}

export type Scored = { att: MatchAttraction; score: number };

// Fuzzy, transliteration-tolerant shortlist. City tokens are ignored so
// "מוזיאון ואן גוך אמסטרדם" still keys on "ואן גוך", not "אמסטרדם".
export function shortlist(
  placeName: string, cityTokens: Set<string>, atts: MatchAttraction[], limit = 10
): Scored[] {
  const placeNorm = norm(placeName);
  if (placeNorm.length < 2) return [];
  const pTokAll = tokens(placeName);
  const pTok = new Set([...pTokAll].filter((t) => !cityTokens.has(t)));
  const useTok = pTok.size ? pTok : pTokAll; // don't blank out a pure-city-token place
  const pBi = bigrams(placeName);
  const scored: Scored[] = [];
  for (const att of atts) {
    const s = Math.max(
      nameScore(placeNorm, useTok, pBi, att.name_en),
      nameScore(placeNorm, useTok, pBi, att.name_he ?? "")
    );
    if (s >= 0.34) scored.push({ att, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// A confident deterministic hit: exact normalized name equality only.
export function exactHit(placeName: string, atts: MatchAttraction[]): number | null {
  const p = norm(placeName);
  if (p.length < 3) return null;
  for (const a of atts) {
    if (norm(a.name_en) === p || norm(a.name_he) === p) return a.id;
  }
  return null;
}

// ---- LLM resolution ---------------------------------------------------------
const RESOLVE_SYSTEM =
  "You match a traveller's mention of a place to the ONE correct attraction in " +
  "our database, or reject it. You are given, per mention, a numbered candidate " +
  "list (id + names, Hebrew & English). Return the id of the candidate that IS " +
  "that place — accounting for Hebrew/English spelling and transliteration " +
  "(e.g. 'הייניקן' = Heineken, 'ואן גוך' = Van Gogh). Return null when NONE of " +
  "the candidates is clearly the same place, OR when the mention is not a " +
  "sightseeing attraction at all: a supermarket/shop/brand (Albert Heijn, " +
  "Primark), a restaurant/cafe/bakery, a hotel, a shopping street, an airport/" +
  "airline, or a place OUTSIDE this city (a day-trip town). Beware traps: a " +
  "market ('שוק אלברט קאופ') is NOT a monument that merely shares a name " +
  "('אנדרטת אלברט'); a museum is NOT a park with a similar name. If the mention " +
  "is the city/region name itself, return null. CRITICAL: a WRONG match is far " +
  "worse than NO match — return null unless a candidate is unmistakably the SAME " +
  "specific place; a shared word or loose thematic overlap is NOT enough.";

const RESOLVE_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, id: { type: ["integer", "null"] } },
        required: ["i", "id"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

export type ResolveInput = { place: string; candidates: MatchAttraction[] };

// Resolve a batch of place mentions → attraction id or null. Deterministic
// exact hits are taken without the model; the rest go to Claude with their
// shortlists. `valid` guards against the model inventing an id.
async function resolveWithModel(
  inputs: ResolveInput[], cityName: string, client: Anthropic, model: string
): Promise<(number | null)[]> {
  if (!inputs.length) return [];
  const valid = new Set<number>();
  const blocks = inputs.map((inp, i) => {
    const lines = inp.candidates.map((c) => {
      valid.add(c.id);
      return `    ${c.id}: ${c.name_he ?? ""} / ${c.name_en}`;
    });
    return `#${i} mention: "${inp.place}"\n  candidates:\n${lines.join("\n") || "    (none)"}`;
  });
  const msg = await client.messages.create({
    model,
    max_tokens: 4000,
    system: RESOLVE_SYSTEM,
    messages: [{ role: "user", content:
      `City: ${cityName}\nFor each mention, return {i, id} where id is the matching candidate id or null.\n\n${blocks.join("\n\n")}` }],
    tools: [{ name: "resolve", description: "return matches", input_schema: RESOLVE_SCHEMA }],
    tool_choice: { type: "tool", name: "resolve" },
  } as Parameters<typeof client.messages.create>[0]);
  const r = msg as { content: { type: string; input?: { matches?: { i: number; id: number | null }[] } }[] };
  const out: (number | null)[] = inputs.map(() => null);
  const got = r.content.find((b) => b.type === "tool_use")?.input?.matches ?? [];
  for (const m of got) {
    if (m.i >= 0 && m.i < inputs.length) out[m.i] = m.id != null && valid.has(m.id) ? m.id : null;
  }
  return out;
}

// Public: resolve distinct place names → attraction id or null. Batches the
// model calls. `cityNames` = the city's names (he + en) — used to drop the junk
// "<city>" attraction row and to null-out mentions that are just the city.
export async function resolvePlaces(
  places: string[], cityNames: string[], attsIn: MatchAttraction[], model: string
): Promise<Map<string, number | null>> {
  const cityNorms = cityNames.map(norm).filter(Boolean);
  const cityTokens = new Set(cityNames.flatMap((c) => [...tokens(c)]));
  const atts = attsIn.filter(
    (a) => !cityNorms.includes(norm(a.name_en)) && !cityNorms.includes(norm(a.name_he)));
  const cityName = cityNames[0] ?? "";
  const result = new Map<string, number | null>();
  const needModel: ResolveInput[] = [];
  for (const place of new Set(places)) {
    if (cityNorms.includes(norm(place))) { result.set(place, null); continue; } // the city itself
    const exact = exactHit(place, atts);
    if (exact) { result.set(place, exact); continue; }
    const cand = shortlist(place, cityTokens, atts).map((s) => s.att);
    if (!cand.length) { result.set(place, null); continue; }
    needModel.push({ place, candidates: cand });
  }
  if (needModel.length) {
    const client = new Anthropic();
    const BATCH = 20;
    for (let i = 0; i < needModel.length; i += BATCH) {
      const chunk = needModel.slice(i, i + BATCH);
      const ids = await resolveWithModel(chunk, cityName, client, model);
      chunk.forEach((inp, j) => result.set(inp.place, ids[j]));
    }
  }
  return result;
}
