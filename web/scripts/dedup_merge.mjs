// Explicit landmark merges — for pairs where the KEEPER must be chosen by hand
// (the well-known name), not by score, and where the kept row's description should
// absorb the merged feature ("a square that also has a garden"). Each tuple is a
// deliberate editorial decision; guarded so a wrong id can't quietly nuke a row.
//   node web/scripts/dedup_merge.mjs            # dry run (validate + preview)
//   node web/scripts/dedup_merge.mjs --fix      # apply
import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--fix");
const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const hav = (a, g, b, h) => { const R = 6371000, dLa = (b - a) * Math.PI / 180, dLo = (h - g) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(b * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };

// {keep, del, note}. keep = the well-known row to preserve; del = merged away;
// note = appended to keep's tagline (so the description reflects the merge).
const MERGES = [
  // safe-tier flips (keep the famous landmark, not its sub-feature) — no note
  { keep: 6167, del: 5708, note: "" },
  { keep: 5104, del: 5152, note: "" },
  // borderline — merge + describe the combined place
  { keep: 19843, del: 19680, note: "כולל את הכיכר שסביבו" },
  { keep: 4449, del: 5010, note: "ממוקמת בפארק ייעודי" },
  { keep: 5186, del: 4636, note: "מכיל את המוזיאון הלאומי" },
  { keep: 6590, del: 7475, note: "משתרעת בתוך פארק" },
  { keep: 22149, del: 22558, note: "ולצידו גן" },
  { keep: 34331, del: 33704, note: "כוללת מוזיאון" },
  { keep: 34298, del: 34608, note: "מוקפת בפארק" },
  { keep: 97337, del: 96992, note: "ולצידו גן" },
  { keep: 98000, del: 98361, note: "כוללת מוזיאון" },
  { keep: 98134, del: 98135, note: "ולצידה גן" },
  { keep: 99545, del: 99477, note: "כולל מוזיאון" },
  { keep: 2058, del: 2480, note: "כולל בריכת משפחות" },
  { keep: 2332, del: 2441, note: "כולל את חדר האוצר" },
  { keep: 6508, del: 6509, note: "כולל פארק כלבים" },       // flip: keep the grove
  { keep: 7543, del: 7542, note: "ולצידו גנים" },
  { keep: 8911, del: 9394, note: "לצידו מוזיאון החומה" },
  { keep: 75380, del: 75188, note: "כולל את הקטע הדרומי" },  // flip: keep the beach
  { keep: 25275, del: 24685, note: "ובו אנדרטת מלחמה" },     // flip: keep the green
  { keep: 80403, del: 24872, note: "לצידו אנדרטת המלחמה" },
  { keep: 88644, del: 33695, note: "כולל מוזיאון תיאטרון" },
  { keep: 95861, del: 95966, note: "" },                     // flip: keep "citadel of Brasov"
  { keep: 36970, del: 36329, note: "ולצידו גן" },
  { keep: 97551, del: 97640, note: "ובו נדנדה נודעת" },
];

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const ids = [...new Set(MERGES.flatMap((m) => [m.keep, m.del]))];
const rows = new Map((await c.query(
  `select id, name_he, destination_id, lat, lng, tagline_he from attractions where id = any($1)`, [ids])).rows.map((r) => [r.id, r]));

let ok = 0, bad = 0;
const valid = [];
for (const m of MERGES) {
  const k = rows.get(m.keep), d = rows.get(m.del);
  if (!k || !d) { console.log(`✗ SKIP keep#${m.keep}/del#${m.del} — missing row`); bad++; continue; }
  if (k.destination_id !== d.destination_id) { console.log(`✗ SKIP #${m.keep}/#${m.del} — different cities`); bad++; continue; }
  const dist = Math.round(hav(k.lat, k.lng, d.lat, d.lng));
  if (dist > 200) { console.log(`✗ SKIP #${m.keep}/#${m.del} — ${dist}m apart (>200)`); bad++; continue; }
  console.log(`✓ KEEP "${k.name_he}"  ⟵ del "${d.name_he}"  (${dist}m)${m.note ? `  +תיאור: «${m.note}»` : ""}`);
  valid.push({ ...m, k });
  ok++;
}
console.log(`\n${ok} valid · ${bad} skipped`);
if (!APPLY) { console.log("\n(dry run — pass --fix to apply)"); await c.end(); process.exit(0); }

const affected = new Set();
for (const m of valid) {
  await c.query(`update insights set attraction_id=$1 where attraction_id=$2`, [m.keep, m.del]).catch(() => {});
  if (m.note) {
    const cur = m.k.tagline_he || "";
    if (!cur.includes(m.note))
      await c.query(`update attractions set tagline_he=$1 where id=$2`,
        [cur ? `${cur} · ${m.note}` : m.note, m.keep]);
  }
  await c.query(`delete from editor_picks where attraction_id=$1`, [m.del]).catch(() => {});
  await c.query(`delete from attractions where id=$1`, [m.del]);
  affected.add(m.k.destination_id);
}
for (const d of affected)
  await c.query(`update areas a set attraction_count=(select count(*) from attractions t where t.area_id=a.id) where a.destination_id=$1`, [d]);
console.log(`\n✔ merged ${valid.length} pairs · resynced areas for ${affected.size} cities`);
await c.end();
