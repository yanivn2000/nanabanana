// Wrong-city audit (DB only — no API). See docs/logic + feedback on data bugs.
//
//   node web/scripts/audit_wrong_city.mjs            # report only (dry run)
//   node web/scripts/audit_wrong_city.mjs --fix      # apply: reassign / null out
//
// Finds attractions whose coordinates are far from their own destination's centre
// (> FAR_KM) — almost always a wrong destination_id (a Rome landmark tagged to
// Milan). For each, finds the NEAREST destination: if it's a different city and
// close (< NEAR_KM), the fix reassigns destination_id to it (and clears area_id,
// so areas must be re-run for both cities). If nothing is near, it's flagged for
// manual review (not auto-deleted).
import { readFileSync } from "node:fs";
import pg from "pg";

const FAR_KM = 100;   // farther than this from own city centre = suspicious
const NEAR_KM = 45;   // within this of another city centre = confidently reassign
const APPLY = process.argv.includes("--fix");

const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const hav = (a, g, b, h) => {
  const R = 6371, dLa = (b - a) * Math.PI / 180, dLo = (h - g) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(b * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const dests = (await c.query(`select id, city, city_he, lat, lng from destinations where lat is not null`)).rows;
const atts = (await c.query(
  `select id, name_he, name_en, destination_id, lat, lng from attractions where lat is not null and lng is not null`)).rows;

const nameById = new Map(dests.map((d) => [d.id, d.city_he || d.city]));
const flagged = [];
for (const a of atts) {
  const own = dests.find((d) => d.id === a.destination_id);
  if (!own) continue;
  const distOwn = hav(a.lat, a.lng, own.lat, own.lng);
  if (distOwn <= FAR_KM) continue;
  let nearest = null, nd = Infinity;
  for (const d of dests) {
    if (d.id === a.destination_id) continue;
    const dk = hav(a.lat, a.lng, d.lat, d.lng);
    if (dk < nd) { nd = dk; nearest = d; }
  }
  flagged.push({ a, distOwn, nearest, nd });
}
flagged.sort((x, y) => y.distOwn - x.distOwn);

const reassign = flagged.filter((f) => f.nearest && f.nd < NEAR_KM);
const review = flagged.filter((f) => !(f.nearest && f.nd < NEAR_KM));
console.log(`flagged ${flagged.length} attractions > ${FAR_KM}km from their city centre`);
console.log(`  → ${reassign.length} confidently reassignable (< ${NEAR_KM}km from another city)`);
console.log(`  → ${review.length} need manual review (not near any city)\n`);
for (const f of flagged) {
  const nm = f.a.name_he || f.a.name_en;
  const act = f.nearest && f.nd < NEAR_KM
    ? `REASSIGN → ${nameById.get(f.nearest.id)} (${Math.round(f.nd)}km)`
    : `REVIEW (nearest ${f.nearest ? nameById.get(f.nearest.id) : "?"} ${Math.round(f.nd)}km)`;
  console.log(`  [${f.a.id}] "${nm}" in ${nameById.get(f.a.destination_id)} — ${Math.round(f.distOwn)}km away · ${act}`);
}

if (APPLY && reassign.length) {
  for (const f of reassign) {
    await c.query(`update attractions set destination_id=$1, area_id=null where id=$2`, [f.nearest.id, f.a.id]);
  }
  const affected = [...new Set(reassign.flatMap((f) => [f.a.destination_id, f.nearest.id]))];
  console.log(`\n✔ reassigned ${reassign.length} attractions. Re-run areas for cities: ${affected.join(", ")}`);
} else if (reassign.length) {
  console.log(`\n(dry run — pass --fix to reassign the ${reassign.length} confident cases)`);
}
await c.end();
