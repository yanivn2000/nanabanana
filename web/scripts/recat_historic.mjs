// Recategorise clearly-historic places miscategorised as category "attraction".
// OSM's tourism=attraction is a catch-all; many cities file castles/ruins/monuments
// there (Lisbon: 61), which then out-weighs themes in the balance model. This flips
// only rows whose SUBCATEGORY is unambiguously historic → category "historic".
// Subcategory-based (reliable) — never touches the generic "attraction" subcategory
// (a mixed bag: zoo animals, elevators, a bakery…). Idempotent.
// Usage:  node scripts/recat_historic.mjs [--dry] [--only=16]
import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); config({ path: ".env" });
const DRY = process.argv.includes("--dry");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "")
  .split(",").filter(Boolean).map(Number);
const HIST_SUBS = ["castle", "fort", "fortress", "ruins", "archaeological_site",
  "monument", "city_gate", "citywalls", "tower", "monastery", "manor", "battlefield"];
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const where = `category = 'attraction' AND subcategory = ANY($1)`
  + (ONLY.length ? ` AND destination_id = ANY($2)` : "");
const params = ONLY.length ? [HIST_SUBS, ONLY] : [HIST_SUBS];

const rows = await pool.query(
  `SELECT id, destination_id, subcategory, name_he, name_en FROM attractions WHERE ${where}`, params);
const bySub = {}; for (const r of rows.rows) bySub[r.subcategory] = (bySub[r.subcategory] || 0) + 1;
console.log(`${DRY ? "[DRY] " : ""}attraction → historic: ${rows.rows.length} rows`);
console.log("  by subcategory:", JSON.stringify(bySub));
console.log("  sample:", rows.rows.slice(0, 10).map((r) => r.name_he || r.name_en).join(", "));

if (!DRY && rows.rows.length) {
  const r = await pool.query(`UPDATE attractions SET category='historic' WHERE ${where}`, params);
  console.log(`applied — ${r.rowCount} rows updated.`);
}
await pool.end();
