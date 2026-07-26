// Tag nightlife venues with the "nightlife" taste tag (by SUBCATEGORY only — reliable,
// avoids restaurants merely named "…Bar"). Idempotent. Also strips a stray "nightlife"
// tag from clearly-non-nightlife rows (museums/historic/nature/shopping) that a name
// match mis-tagged. Run: node scripts/tag_nightlife.mjs [--dry]
import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); config({ path: ".env" });
const DRY = process.argv.includes("--dry");
const NL_SUB = ['bar','pub','nightclub','cocktail','wine_bar','biergarten','brewery','jazz_club','music_venue','lounge','nightlife','disco'];
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ADD: nightlife-subcategory rows missing the tag
const add = await pool.query(
  `select id, name_he, name_en, taste_tags from attractions
    where subcategory = any($1) and not coalesce(taste_tags @> '["nightlife"]', false)
      and (quality_keep=1 or quality_keep is null) and (is_duplicate is null or is_duplicate=0)`, [NL_SUB]);
// REMOVE: stray nightlife tag on non-nightlife categories (name-match false positives)
const rem = await pool.query(
  `select id, name_he, name_en, category, subcategory, taste_tags from attractions
    where taste_tags @> '["nightlife"]' and category in ('museum','historic','nature','shopping')
      and not (subcategory = any($1))`, [NL_SUB]);

console.log(`ADD nightlife tag → ${add.rows.length} rows; REMOVE stray tag → ${rem.rows.length} rows${DRY?" (DRY)":""}`);
console.log("  sample add:", add.rows.slice(0,8).map(r=>r.name_he||r.name_en).join(", "));
if (rem.rows.length) console.log("  remove:", rem.rows.map(r=>`${r.name_he||r.name_en}[${r.category}/${r.subcategory}]`).join(", "));

if (!DRY) {
  for (const r of add.rows) {
    const tags = Array.isArray(r.taste_tags) ? r.taste_tags : [];
    await pool.query(`update attractions set taste_tags=$1 where id=$2`, [JSON.stringify([...new Set([...tags,"nightlife"])]), r.id]);
  }
  for (const r of rem.rows) {
    const tags = (Array.isArray(r.taste_tags)?r.taste_tags:[]).filter(t=>t!=="nightlife");
    await pool.query(`update attractions set taste_tags=$1 where id=$2`, [JSON.stringify(tags), r.id]);
  }
  console.log("applied.");
}
await pool.end();
