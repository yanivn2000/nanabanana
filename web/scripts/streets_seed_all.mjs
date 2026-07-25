// Seed WORTHY streets for every city from curated lists in scripts/streets_data/*.json.
//
//   node web/scripts/streets_seed_all.mjs           # fetch geometry + insert (approved)
//   node web/scripts/streets_seed_all.mjs --dry     # match/report only, no writes
//
// Each curated street gives a LOCAL-language OSM name + an approx midpoint. We fetch
// the matching highway/waterway ways from Overpass NEAR that point (so a same-named
// street elsewhere can't match), STITCH the ways endpoint-to-endpoint into one ordered
// polyline, validate it sits near the expected spot, then upsert into `streets`
// (approved=true). A long street is fine — the builder trims it to a ~750m stretch.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const DRY = process.argv.includes("--dry");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7)
  .split(",").filter(Boolean).map(Number);
const DIR = new URL("./streets_data/", import.meta.url);
const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = 6371000, rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]);
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

let mi = 0;
async function overpass(query) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = MIRRORS[mi % MIRRORS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
      });
      if (res.status === 429 || res.status === 504 || res.status === 502) { mi++; await sleep(2000 + attempt * 1500); continue; }
      if (!res.ok) { mi++; await sleep(1000); continue; }
      return await res.json();
    } catch { mi++; await sleep(1500); }
  }
  return null;
}

// escape a name for Overpass regex.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Some countries DROP the generic street-word from the OSM name tag (Polish
// "Ulica Szeroka" is tagged just "Szeroka"; "Ul. …" likewise). Others KEEP it
// (Italian "Via …", German "…straße", Romanian "Strada …"), so only strip the few
// that are reliably dropped. Returns the distinct name candidates to match on.
function nameVariants(name) {
  const out = [name];
  const stripped = name.replace(/^(Ulica|Ul\.?|Vulytsia|Vul\.?)\s+/i, "");
  if (stripped !== name) out.push(stripped);
  return out;
}

// Assemble ways (each an ordered [lat,lng][]) into the longest stitched chain.
function stitch(ways) {
  if (!ways.length) return [];
  const near = (p, q) => hav(p, q) < 25; // 25m endpoint tolerance
  let chain = ways[0].slice();
  const pool = ways.slice(1);
  let moved = true;
  while (moved && pool.length) {
    moved = false;
    for (let i = 0; i < pool.length; i++) {
      const w = pool[i], a = chain[0], b = chain[chain.length - 1];
      if (near(b, w[0])) { chain = chain.concat(w.slice(1)); pool.splice(i, 1); moved = true; break; }
      if (near(b, w[w.length - 1])) { chain = chain.concat(w.slice().reverse().slice(1)); pool.splice(i, 1); moved = true; break; }
      if (near(a, w[w.length - 1])) { chain = w.slice().concat(chain.slice(1)); pool.splice(i, 1); moved = true; break; }
      if (near(a, w[0])) { chain = w.slice().reverse().concat(chain.slice(1)); pool.splice(i, 1); moved = true; break; }
    }
  }
  return chain;
}

function pathStats(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += hav(path[i - 1], path[i]);
  const clat = path.reduce((s, p) => s + p[0], 0) / path.length;
  const clng = path.reduce((s, p) => s + p[1], 0) / path.length;
  return { len, clat, clng };
}

// ONE Overpass query per city: fetch every way whose name matches ANY curated
// street (regex-OR), within the bbox of the city's approx points. Returns a
// name→ways map. Batching this way turns ~250 street lookups into ~30 queries.
async function fetchCityWays(streets) {
  const lats = streets.map((s) => s.approx_lat), lngs = streets.map((s) => s.approx_lng);
  const pad = 0.025;
  const bbox = `${Math.min(...lats) - pad},${Math.min(...lngs) - pad},${Math.max(...lats) + pad},${Math.max(...lngs) + pad}`;
  const re = [...new Set(streets.flatMap((s) => nameVariants(s.name_local)))].map(esc).join("|");
  const hasCanal = streets.some((s) => s.kind === "canal");
  const q = `[out:json][timeout:180];(way["highway"]["name"~"^(${re})$",i](${bbox});`
    + (hasCanal ? `way["waterway"]["name"~"^(${re})$",i](${bbox});` : "")
    + `);(._;>;);out body;`;
  const j = await overpass(q);
  if (!j?.elements?.length) return null;
  const nodes = new Map();
  for (const e of j.elements) if (e.type === "node") nodes.set(e.id, [e.lat, e.lon]);
  const byName = new Map();
  for (const e of j.elements) {
    if (e.type !== "way" || !e.nodes?.length) continue;
    const nm = (e.tags?.name || "").toLowerCase();
    const coords = e.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (coords.length < 2) continue;
    if (!byName.has(nm)) byName.set(nm, []);
    byName.get(nm).push({ coords, id: e.id });
  }
  return byName;
}

// Match one curated street against the city's fetched ways: pick the ways with that
// name NEAR its approx point, stitch, validate the centroid sits where expected.
function matchStreet(st, byName) {
  if (!byName) return null;
  let ways = null;
  for (const v of nameVariants(st.name_local)) { ways = byName.get(v.toLowerCase()); if (ways?.length) break; }
  if (!ways?.length) return null;
  const at = [st.approx_lat, st.approx_lng];
  const near = ways.filter((w) => w.coords.some((p) => hav(p, at) < 3000));
  const use = near.length ? near : ways;
  const path = stitch(use.map((w) => w.coords));
  if (path.length < 2) return null;
  const stats = pathStats(path);
  if (hav([stats.clat, stats.clng], at) > 3500) return null;
  return { path, ...stats, osmId: use[0].id };
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
let inserted = 0, failed = 0, skipped = 0;
const failReport = [];

for (const f of files.sort()) {
  const data = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
  const did = data.destination_id;
  if (ONLY.length && !ONLY.includes(did)) continue;
  const existing = new Set((await c.query(
    `select lower(name_en) n from streets where destination_id=$1`, [did])).rows.map((r) => r.n));
  const pending = (data.streets ?? []).filter((st) => !existing.has((st.name_en || "").toLowerCase()));
  skipped += (data.streets?.length ?? 0) - pending.length;
  if (!pending.length) { console.log(`${data.city.padEnd(14)} (all existing, skipped)`); continue; }
  const byName = await fetchCityWays(pending);
  await sleep(1200); // be gentle between cities
  let cityIns = 0, cityFail = 0;
  for (const st of pending) {
    const geo = matchStreet(st, byName);
    if (!geo) { failed++; cityFail++; failReport.push(`${data.city}: ${st.name_local}`); continue; }
    if (!DRY) {
      // area link: nearest area whose centroid is within its radius of the street.
      const area = (await c.query(
        `select id, lat, lng, radius_m from areas where destination_id=$1`, [did])).rows
        .map((a) => ({ id: a.id, d: hav([geo.clat, geo.clng], [a.lat, a.lng]), r: a.radius_m || 1200 }))
        .filter((a) => a.d <= a.r).sort((a, b) => a.d - b.d)[0];
      await c.query(
        `insert into streets (destination_id,name_en,name_he,kind,best_for_he,vibe_he,lat,lng,geometry,osm_id,approved,dwell_min,length_m,area_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13)`,
        [did, st.name_en, st.name_he, st.kind || "street", st.best_for_he, st.vibe_he,
         geo.clat, geo.clng, JSON.stringify(geo.path), geo.osmId, st.dwell_min || 40, Math.round(geo.len), area?.id ?? null]);
    }
    inserted++; cityIns++;
  }
  console.log(`${data.city.padEnd(14)} +${cityIns} inserted, ${cityFail} unmatched${DRY ? " (dry)" : ""}`);
}

console.log(`\n${DRY ? "[DRY] " : ""}TOTAL inserted ${inserted}, unmatched ${failed}, skipped(existing) ${skipped}`);
if (failReport.length) console.log("UNMATCHED (need manual/OSM-name fix):\n  " + failReport.join("\n  "));
await c.end();
