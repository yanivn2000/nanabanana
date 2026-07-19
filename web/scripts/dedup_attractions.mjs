// De-duplicate attractions (DB only — no API). See feedback on data bugs.
//
//   node web/scripts/dedup_attractions.mjs         # report only (dry run)
//   node web/scripts/dedup_attractions.mjs --fix    # apply
//
// OSM ingest left exact-name duplicate rows (same place, several nodes). For each
// (destination_id, name_he) group with >1 row, keep the MOST COMPLETE row (must_see
// > has image > has audience_fit > enriched > lowest id) and remove the rest. Before
// deleting, traveller insights are reassigned to the kept row and the kept row
// inherits an area_id if it lacked one; attraction_edges cascade. After deleting,
// each affected city's areas are resynced (member_ids + attraction_count) from the
// live area_id join, so authored area names/vibes are preserved.
import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--fix");
const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

// completeness-ranked rows within each duplicate name-group
const groups = (await c.query(`
  select destination_id, name_he,
    array_agg(id order by
      (coalesce(must_see,0)) desc,
      (image_url is not null) desc,
      (audience_fit is not null) desc,
      (coalesce(tips_he, tagline_he, description_he) is not null) desc,
      id asc) ids,
    array_agg(area_id order by
      (coalesce(must_see,0)) desc, (image_url is not null) desc,
      (audience_fit is not null) desc, id asc) area_ids
  from attractions where name_he is not null
  group by destination_id, name_he having count(*) > 1`)).rows;

let keep = 0, del = 0;
const affected = new Set();
const toDelete = [];
for (const g of groups) {
  keep++;
  const [keepId, ...dups] = g.ids;
  const keepArea = g.area_ids[0];
  const dupArea = g.area_ids.slice(1).find((a) => a != null);
  affected.add(g.destination_id);
  for (const d of dups) { del++; toDelete.push({ keepId, dupId: d, keepArea, dupArea }); }
}
console.log(`${groups.length} duplicate name-groups · keep ${keep} · delete ${del} rows · ${affected.size} cities affected`);
console.log("sample (keep ← delete):");
for (const t of toDelete.slice(0, 10)) console.log(`  keep ${t.keepId} ← delete ${t.dupId}`);

if (!APPLY) { console.log("\n(dry run — pass --fix to apply)"); await c.end(); process.exit(0); }

let insMoved = 0;
for (const t of toDelete) {
  const r = await c.query(`update insights set attraction_id=$1 where attraction_id=$2`, [t.keepId, t.dupId]);
  insMoved += r.rowCount;
  if (t.keepArea == null && t.dupArea != null)
    await c.query(`update attractions set area_id=$1 where id=$2 and area_id is null`, [t.dupArea, t.keepId]);
  await c.query(`delete from editor_picks where attraction_id=$1`, [t.dupId]).catch(() => {});
  await c.query(`delete from attractions where id=$1`, [t.dupId]);   // edges cascade
}
// resync each affected city's areas.attraction_count from the live join
// (member_ids is computed live in headlineAreasForCity, so it needs no resync).
for (const destId of affected) {
  await c.query(`
    update areas a set attraction_count = (select count(*) from attractions t where t.area_id=a.id)
    where a.destination_id=$1`, [destId]);
}
const tot = await c.query(`select count(*) n from attractions`);
console.log(`\n✔ deleted ${del} dup rows · moved ${insMoved} insights · resynced areas for ${affected.size} cities · attractions now ${tot.rows[0].n}`);
await c.end();
