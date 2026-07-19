// Neighbourhood discovery (deterministic — no API). See docs/logic/neighborhoods.md.
//
//   node web/scripts/areas_discover.mjs <destId> [k] > /tmp/clusters.json
//
// Clusters a city's VISIT-WORTHY attractions (must_see OR audience_fit.couples>=50)
// with k-means, drops clusters < 3, and prints the clusters as JSON. A Claude
// session then authors name/vibe/best_for/gateway per cluster (see the spec) and
// feeds the result to areas_write.mjs.
import { readFileSync } from "node:fs";
import pg from "pg";

const destId = Number(process.argv[2]);
const K = Number(process.argv[3] || 16);
const MIN = 3;
if (!destId) { console.error("usage: areas_discover.mjs <destId> [k]"); process.exit(1); }

const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");

const hav = (a, g, b, h) => {
  const R = 6371, dLa = (b - a) * Math.PI / 180, dLo = (h - g) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(b * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const A = (await c.query(
  `select id, name_he, name_en, lat, lng, coalesce(must_see,0) must_see, (audience_fit->>'couples')::int couples
     from attractions where destination_id=$1 and lat is not null and lng is not null
       and (must_see=1 or (audience_fit->>'couples')::int >= 50)`, [destId])).rows;
await c.end();

if (A.length < K) { console.error(`only ${A.length} worthy attractions — lower k`); }
const n = A.length, pts = A.map((a) => [a.lat, a.lng]);
// k-means++ init
const cen = [pts[0]];
while (cen.length < Math.min(K, n)) {
  let best = null, bs = -1;
  for (const p of pts) { let md = Infinity; for (const c2 of cen) { const d = hav(p[0], p[1], c2[0], c2[1]); if (d < md) md = d; } if (md > bs) { bs = md; best = p; } }
  cen.push(best);
}
const assign = new Array(n).fill(0);
for (let it = 0; it < 50; it++) {
  let ch = false;
  for (let i = 0; i < n; i++) { let bi = 0, bd = Infinity; for (let k = 0; k < cen.length; k++) { const d = hav(pts[i][0], pts[i][1], cen[k][0], cen[k][1]); if (d < bd) { bd = d; bi = k; } } if (assign[i] !== bi) { assign[i] = bi; ch = true; } }
  for (let k = 0; k < cen.length; k++) { const m = pts.filter((_, i) => assign[i] === k); if (!m.length) continue; cen[k] = [m.reduce((s, p) => s + p[0], 0) / m.length, m.reduce((s, p) => s + p[1], 0) / m.length]; }
  if (!ch) break;
}
const nm = (a) => a.name_he || a.name_en;
let out = [];
for (let k = 0; k < cen.length; k++) {
  const mem = A.filter((_, i) => assign[i] === k);
  if (mem.length < MIN) continue;
  const lat = cen[k][0], lng = cen[k][1];
  const radius = Math.round(1000 * Math.max(...mem.map((a) => hav(lat, lng, a.lat, a.lng))));
  const top = [...mem].sort((a, b) => (b.must_see - a.must_see) || ((b.couples || 0) - (a.couples || 0)));
  out.push({ lat: +lat.toFixed(5), lng: +lng.toFixed(5), radius_m: radius, count: mem.length,
    member_ids: mem.map((a) => a.id), sample: top.slice(0, 10).map(nm) });
}
out.sort((a, b) => b.count - a.count);
console.error(`worthy=${n} k=${cen.length} areas>=${MIN}: ${out.length}`);
process.stdout.write(JSON.stringify(out, null, 2));
