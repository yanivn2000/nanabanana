// Near-duplicate dedup (same place, slightly different name) — DB only, no API.
//   node web/scripts/dedup_near.mjs         # report (dry run)
//   node web/scripts/dedup_near.mjs --fix    # apply
//
// PRECISE + safe: two attractions in the same city, <=10m apart, that are the same
// place named differently. Only two signals (both tight, to avoid deleting distinct
// co-located things like aircraft models / Stolpersteine / west+east stations):
//   A) names equal after removing ONLY a trailing city-name suffix or a "(n)" counter
//      — e.g. "שער הדריאנוס, אתונה" == "שער הדריאנוס", "כיכר הפטריארך (2)" == "כיכר הפטריארך".
//   B) the parenthetical of one == the other's full name — e.g.
//      "מגדל אליזבת (ביג בן)" vs "ביג בן".
// Keeps the most complete row, reassigns insights, cascades edges, resyncs areas.
import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--fix");
const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const hav = (a, g, b, h) => { const R = 6371000, dLa = (b - a) * Math.PI / 180, dLo = (h - g) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(b * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const cityNames = new Set((await c.query(`select city_he from destinations where city_he is not null`)).rows
  .map((r) => r.city_he).concat((await c.query(`select city from destinations`)).rows.map((r) => r.city)));
const A = (await c.query(`select id, name_he, destination_id, lat, lng,
  (coalesce(must_see,0)) ms, (image_url is not null) img, (audience_fit is not null) af
  from attractions where name_he is not null and lat is not null`)).rows;

const paren = (s) => { const m = s.match(/\(([^)]+)\)$/); return m ? m[1].trim() : null; };
// strip ONLY a trailing city suffix or a (n) counter — nothing else.
const stripSafe = (s) => {
  let t = s.replace(/\s*\(\d+\)\s*$/, "");                          // "(2)"
  for (const city of cityNames) if (city && city.length >= 3)
    t = t.replace(new RegExp(`\\s*[,—–-]\\s*${city}\\s*$`), "");    // ", אתונה" / " — לונדון"
  return t.replace(/\s+/g, " ").trim();
};

const cell = new Map();
for (const a of A) { const k = a.destination_id + ":" + a.lat.toFixed(3) + ":" + a.lng.toFixed(3); (cell.get(k) ?? cell.set(k, []).get(k)).push(a); }
const score = (x) => (x.ms ? 4 : 0) + (x.img ? 2 : 0) + (x.af ? 1 : 0);
const del = new Set(), moves = [];
for (const [, g] of cell) { if (g.length < 2) continue;
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const a = g[i], b = g[j]; if (del.has(a.id) || del.has(b.id)) continue;
    if (hav(a.lat, a.lng, b.lat, b.lng) > 10) continue;
    const ruleA = a.name_he !== b.name_he && stripSafe(a.name_he) === stripSafe(b.name_he);
    const ruleB = paren(a.name_he) === b.name_he || paren(b.name_he) === a.name_he;
    if (!ruleA && !ruleB) continue;
    const loser = score(a) >= score(b) ? b : a, keeper = loser === a ? b : a;
    del.add(loser.id);
    moves.push({ loser: loser.id, keeper: keeper.id, kn: keeper.name_he, ln: loser.name_he, dest: a.destination_id });
  }
}
console.log(`near-dup rows to remove: ${del.size}`);
moves.slice(0, 30).forEach((m) => console.log(`  keep "${m.kn}" ← del "${m.ln}"`));

if (!APPLY) { console.log("\n(dry run — pass --fix to remove)"); await c.end(); process.exit(0); }
for (const m of moves) {
  await c.query(`update insights set attraction_id=$1 where attraction_id=$2`, [m.keeper, m.loser]);
  await c.query(`delete from editor_picks where attraction_id=$1`, [m.loser]).catch(() => {});
  await c.query(`delete from attractions where id=$1`, [m.loser]);   // edges cascade
}
const affected = [...new Set(moves.map((m) => m.dest))];
for (const d of affected) await c.query(`update areas a set attraction_count=(select count(*) from attractions t where t.area_id=a.id) where a.destination_id=$1`, [d]);
console.log(`\n✔ removed ${del.size} near-dup rows · resynced areas for ${affected.length} cities`);
await c.end();
