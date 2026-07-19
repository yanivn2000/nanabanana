// Neighbourhood write (DB only — no API). See docs/logic/neighborhoods.md.
//
//   node web/scripts/areas_write.mjs <destId> /tmp/areas.json
//
// areas.json = the discovered clusters ENRICHED by the agent, an array where each
// item has: name_he, name_en, lat, lng, radius_m, vibe_he, best_for (array),
// gateway_he, member_ids (array). Replaces the destination's areas (idempotent)
// and tags attractions.area_id for the members. Areas start approved=false.
import { readFileSync } from "node:fs";
import pg from "pg";

const destId = Number(process.argv[2]);
const path = process.argv[3];
if (!destId || !path) { console.error("usage: areas_write.mjs <destId> <areas.json>"); process.exit(1); }

const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const areas = JSON.parse(readFileSync(path, "utf8"));

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(`update attractions set area_id=null where destination_id=$1`, [destId]);
await c.query(`delete from areas where destination_id=$1`, [destId]);
let inserted = 0, tagged = 0;
for (const a of areas) {
  const r = await c.query(
    `insert into areas (destination_id,name_he,name_en,lat,lng,radius_m,vibe_he,best_for,gateway_he,attraction_count,source,approved)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'kmeans',false) returning id`,
    [destId, a.name_he, a.name_en, a.lat, a.lng, a.radius_m, a.vibe_he, a.best_for, a.gateway_he, (a.member_ids || []).length]);
  const id = r.rows[0].id; inserted++;
  if (a.member_ids?.length) {
    const up = await c.query(`update attractions set area_id=$1 where id = any($2)`, [id, a.member_ids]);
    tagged += up.rowCount;
  }
}
console.error(`inserted ${inserted} areas, tagged ${tagged} attractions for dest ${destId}`);
await c.end();
