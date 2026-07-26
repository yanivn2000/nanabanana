// Curated nightlife seed — editor/AI-authored venue lists, VERIFIED against OSM.
//
// For each web/scripts/nightlife_data/<id>_<city>.json we take the curated venue
// names, find the matching node/way in OpenStreetMap (ONE batched Overpass query
// per city, regex-OR of the names within the city bbox), and — only when a real
// OSM match is found (so no hallucinated coordinates ever land) — insert it into
// `attractions` as category=food / subcategory=<going-out kind> / taste=["nightlife"].
//
// Idempotent: skips a venue already present by osm_id or by (dest, name_en).
// Usage:  node scripts/nightlife_seed.mjs [--dry] [--only=13,4] [--loose]
import { readdirSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); config({ path: ".env" });

const DIR = new URL("./nightlife_data/", import.meta.url);
const DRY = process.argv.includes("--dry");
const LOOSE = process.argv.includes("--loose");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "")
  .split(",").filter(Boolean).map(Number);

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function overpass(q) {
  for (let i = 0; i < 6; i++) {
    const url = OVERPASS[i % OVERPASS.length];
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }),
        headers: { "User-Agent": "NanaBanana/0.1 (yaniv@eos-online.com)" } });
      if ([429, 502, 503, 504].includes(r.status)) throw new Error("status " + r.status);
      if (!r.ok) throw new Error("status " + r.status);
      return await r.json();
    } catch (e) { console.log(`  overpass ${i + 1} (${url.split("/")[2]}): ${e.message}`); await sleep(12000 * (i + 1)); }
  }
  throw new Error("overpass unavailable");
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s) => (s || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const hav = (a, b) => {
  const R = 6371000, toR = (d) => d * Math.PI / 180;
  const dlat = toR(b[0] - a[0]), dlng = toR(b[1] - a[1]);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dlng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// authored kind -> OSM-style subcategory (all in INTEREST_CATS["חיי לילה"].subs)
const SUB = { bar: "bar", pub: "pub", nightclub: "nightclub", cocktail: "cocktail",
  rooftop: "bar", live_music: "music_venue", wine_bar: "wine_bar", jazz: "jazz_club" };

const centerOf = (v) => [v.approx_lat, v.approx_lng];

// ONE Overpass query per city: every node/way whose name matches ANY curated venue.
async function fetchCity(venues, center) {
  const pad = 0.16; // ~16km bbox around the city centre
  const bbox = `${center[0] - pad},${center[1] - pad},${center[0] + pad},${center[1] + pad}`;
  const re = [...new Set(venues.map((v) => esc(v.name_local)))].join("|");
  const q = `[out:json][timeout:180];(`
    + `nwr["name"~"^(${re})$",i](${bbox});`
    + `);out center tags;`;
  const j = await overpass(q);
  const byName = new Map();
  for (const el of j.elements || []) {
    const nm = el.tags?.name; if (!nm) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const rec = { name: nm, lat, lng, osmId: String(el.id), osmType: el.type, amenity: el.tags.amenity };
    const k = norm(nm);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(rec);
  }
  return byName;
}
// per-venue loose fallback: search around the approx point, fuzzy name overlap.
async function loose(v) {
  if (v.approx_lat == null || v.approx_lng == null) return null;
  const j = await overpass(`[out:json][timeout:60];nwr(around:500,${v.approx_lat},${v.approx_lng});out center tags;`);
  const target = new Set(norm(v.name_local).split(" ").filter(Boolean));
  let best = null;
  for (const el of j.elements || []) {
    const nm = el.tags?.name; if (!nm) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const nset = new Set(norm(nm).split(" ").filter(Boolean));
    const overlap = [...target].filter((t) => nset.has(t)).length / Math.max(1, target.size);
    if (overlap < 0.6) continue;
    const d = hav([lat, lng], [v.approx_lat, v.approx_lng]);
    if (!best || overlap > best.overlap || (overlap === best.overlap && d < best.d))
      best = { name: nm, lat, lng, osmId: String(el.id), osmType: el.type, amenity: el.tags.amenity, overlap, d };
  }
  return best;
}
function matchVenue(v, byName) {
  const cands = byName.get(norm(v.name_local));
  if (!cands?.length) return null;
  if (cands.length === 1 || v.approx_lat == null) return cands[0];
  // multiple same-named — pick nearest to the approx point
  return cands.slice().sort((a, b) => hav([a.lat, a.lng], centerOf(v)) - hav([b.lat, b.lng], centerOf(v)))[0];
}

const c = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
let inserted = 0, unmatched = 0, skipped = 0;
const missReport = [];

for (const f of files.sort()) {
  const data = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
  const did = data.destination_id;
  if (ONLY.length && !ONLY.includes(did)) continue;
  const drow = (await c.query(`select lat, lng from destinations where id=$1`, [did])).rows[0];
  if (!drow) { console.log(`${data.city}: destination ${did} not found`); continue; }
  const center = [drow.lat, drow.lng];

  const existName = new Set((await c.query(`select lower(name_en) n from attractions where destination_id=$1`, [did])).rows.map((r) => r.n));
  const existOsm = new Set((await c.query(`select osm_id from attractions where destination_id=$1 and osm_id is not null`, [did])).rows.map((r) => String(r.osm_id)));
  const venues = (data.venues ?? []).filter((v) => !existName.has((v.name_en || v.name_local || "").toLowerCase()));
  skipped += (data.venues?.length ?? 0) - venues.length;
  if (!venues.length) { console.log(`${data.city.padEnd(12)} (all existing, skipped)`); continue; }

  const byName = await fetchCity(venues, center);
  await sleep(1200);
  let cityIns = 0, cityMiss = 0;
  for (const v of venues) {
    let m = matchVenue(v, byName);
    if (!m && LOOSE) { m = await loose(v); if (m) console.log(`   ~loose ${data.city}: ${v.name_local} → OSM "${m.name}"`); await sleep(700); }
    if (!m) { unmatched++; cityMiss++; missReport.push(`${data.city}: ${v.name_local}`); continue; }
    if (existOsm.has(m.osmId)) { skipped++; continue; }
    const sub = SUB[v.kind] || "bar";
    if (!DRY) {
      await c.query(
        `insert into attractions
          (destination_id, name_en, name_he, lat, lng, category, subcategory, indoor_outdoor,
           family_score, taste_tags, tagline_he, description_he, osm_id, osm_type, quality_keep)
         values ($1,$2,$3,$4,$5,'food',$6,'indoor',1,$7,$8,$9,$10,$11,1)`,
        [did, v.name_en || v.name_local, v.name_he, m.lat, m.lng, sub,
         JSON.stringify(["nightlife"]), v.best_for_he || null, v.vibe_he || null, m.osmId, m.osmType]);
    }
    existOsm.add(m.osmId);
    inserted++; cityIns++;
  }
  console.log(`${data.city.padEnd(12)} +${cityIns} inserted, ${cityMiss} unmatched${DRY ? " (dry)" : ""}`);
}
console.log(`\n${DRY ? "[DRY] " : ""}TOTAL inserted ${inserted}, unmatched ${unmatched}, skipped ${skipped}`);
if (missReport.length) console.log("UNMATCHED (not found in OSM — dropped, never invented):\n  " + missReport.join("\n  "));
await c.end();
