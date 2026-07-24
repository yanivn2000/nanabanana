// Precompute "which attractions sit ON which street" — a STORED relation, the
// same pattern as attraction_edges (never computed per request).
//
//   node web/scripts/street_attractions.mjs
//
// A street is a CORRIDOR: the attractions along it are the stops you hit while
// walking it. pos_pct (0..1 along the street) gives the walking ORDER for free,
// and lets the planner walk only the SPAN between the stops actually chosen
// instead of the whole way (Prinsengracht is 3.3km; nobody walks it end-to-end).
import { readFileSync } from "node:fs"; import pg from "pg";
const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
  CREATE TABLE IF NOT EXISTS street_attractions (
    street_id int NOT NULL REFERENCES streets(id) ON DELETE CASCADE,
    attraction_id int NOT NULL REFERENCES attractions(id) ON DELETE CASCADE,
    destination_id int NOT NULL,
    dist_m int NOT NULL,           -- metres from the street's polyline
    pos_pct real NOT NULL,         -- 0..1 along the street → the walking order
    approved boolean DEFAULT true, -- editor can reject noise (a random café)
    PRIMARY KEY (street_id, attraction_id)
  )`);
await c.query(`CREATE INDEX IF NOT EXISTS street_attr_street ON street_attractions(street_id)`);
await c.query(`CREATE INDEX IF NOT EXISTS street_attr_attr ON street_attractions(attraction_id)`);

const R = 6371000, rad = (d) => d * Math.PI / 180;
function distSeg(p, a, b) {
  const lat0 = rad((a[0] + b[0]) / 2);
  const X = (q) => [rad(q[1]) * Math.cos(lat0) * R, rad(q[0]) * R];
  const [px, py] = X(p), [ax, ay] = X(a), [bx, by] = X(b);
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}
const segLen = (a, b) => Math.hypot(rad(b[0] - a[0]) * R, rad(b[1] - a[1]) * Math.cos(rad(a[0])) * R);
function onLine(p, geom) {
  const lens = []; let tot = 0;
  for (let i = 1; i < geom.length; i++) { const L = segLen(geom[i - 1], geom[i]); lens.push(L); tot += L; }
  let best = { d: Infinity, pos: 0 }, acc = 0;
  for (let i = 1; i < geom.length; i++) {
    const r = distSeg(p, geom[i - 1], geom[i]);
    if (r.d < best.d) best = { d: r.d, pos: tot ? (acc + r.t * lens[i - 1]) / tot : 0 };
    acc += lens[i - 1];
  }
  return best;
}

const MAX_M = Number(process.argv[2] || 40); // "on this street" threshold
const streets = (await c.query(`select id,destination_id,name_he,geometry from streets where geometry is not null`)).rows;
let total = 0;
for (const s of streets) {
  const atts = (await c.query(
    `select id,coalesce(must_see,0) ms,lat,lng from attractions where destination_id=$1 and lat is not null`,
    [s.destination_id])).rows;
  const hits = atts.map((a) => ({ a, r: onLine([a.lat, a.lng], s.geometry) })).filter((h) => h.r.d <= MAX_M);
  await c.query(`delete from street_attractions where street_id=$1`, [s.id]);
  for (const h of hits) {
    await c.query(
      `insert into street_attractions (street_id,attraction_id,destination_id,dist_m,pos_pct)
       values ($1,$2,$3,$4,$5) on conflict do nothing`,
      [s.id, h.a.id, s.destination_id, Math.round(h.r.d), h.r.pos]);
  }
  total += hits.length;
  if (hits.length) console.log(`  ${s.name_he}: ${hits.length} on-street (${hits.filter((h) => h.a.ms).length} must-see)`);
}
console.log(`\nstored ${total} street↔attraction relations (threshold ${MAX_M}m)`);
await c.end();
