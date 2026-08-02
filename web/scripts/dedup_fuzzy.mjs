// Fuzzy dedup: catch same-place duplicates the exact-name pass missed — Hebrew
// spelling variants (גשר קארל/קרל/קרלוב) and near-identical names. Two signals,
// both requiring proximity + "worthy" rows (must-see / image / description) so
// generic OSM POIs are never touched:
//   A) identical normalized name_en  AND ≤200m   (English name is canonical)
//   B) Hebrew name similarity ≥0.86  AND ≤150m
// Clusters via union-find; keeps the richest row, folds assets, deletes the rest.
//   --apply   write (default = dry run)
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, p) => pool.query(t, p).then((r) => r.rows);

const norm = (s) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function dice(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1); return m; };
  const A = bg(a), B = bg(b); let inter = 0;
  for (const [k, v] of A) if (B.has(k)) inter += Math.min(v, B.get(k));
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
}
const hav = (a, b) => { const R = 6371000, t = (x) => x * Math.PI / 180;
  const s = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s)); };
const len = (s) => (s ? s.length : 0);

const rows = await q(`
  SELECT a.id, a.destination_id, COALESCE(d.city_he,d.city) city, a.name_he, a.name_en, a.lat, a.lng,
    a.must_see, (a.image_url IS NOT NULL AND a.image_url<>'') has_img, a.image_url,
    a.description_he, a.tagline_he, COALESCE(a.family_score,0) score
  FROM attractions a JOIN destinations d ON d.id=a.destination_id
  WHERE (a.is_duplicate IS NULL OR a.is_duplicate=0) AND a.lat IS NOT NULL
    AND (a.must_see=1 OR (a.image_url IS NOT NULL AND a.image_url<>'') OR char_length(COALESCE(a.description_he,''))>40)`, []);

// group by city, build clusters
const byCity = new Map();
for (const r of rows) { (byCity.get(r.destination_id) || byCity.set(r.destination_id, []).get(r.destination_id)).push(r); }

const parent = new Map(); const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { parent.set(find(a), find(b)); };
for (const r of rows) parent.set(r.id, r.id);

// Guards against false merges:
//  - plaque/memorial nodes share a street's English name but are distinct (NYC
//    "אנדרטת רחוב"/"לוח זיכרון" on Broadway etc.) — never merge these.
//  - a "Museum of X" is not "X" — don't merge on same name_en across that split.
const isPlaque = (r) => /אנדרט|לוח זיכרון/.test(r.name_he || "");
const hasMuseum = (r) => /מוזיאון|museum/i.test(`${r.name_he || ""} ${r.name_en || ""}`);
for (const list of byCity.values()) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (isPlaque(a) || isPlaque(b)) continue;
    const dist = hav(a, b);
    const sameEn = norm(a.name_en) && norm(a.name_en) === norm(b.name_en) && norm(a.name_en).length > 3;
    const heSim = dice(a.name_he, b.name_he);
    // same English name → likely same place, unless it's a museum-vs-building split
    const enMerge = sameEn && dist <= 200 && hasMuseum(a) === hasMuseum(b);
    const heMerge = heSim >= 0.86 && dist <= 150;
    if (enMerge || heMerge) union(a.id, b.id);
  }
}

const clusters = new Map();
for (const r of rows) { const root = find(r.id); (clusters.get(root) || clusters.set(root, []).get(root)).push(r); }
// Real spelling-variant dupes are 2–3 rows; anything bigger is a shared-name
// cluster (streets/plaques) that slipped through — skip it for safety.
const dupes = [...clusters.values()].filter((c) => c.length > 1 && c.length <= 4);
const skippedBig = [...clusters.values()].filter((c) => c.length > 4);
for (const c of skippedBig) console.log(`SKIP (too big, ${c.length}×): ${c[0].city} "${c[0].name_en}"`);

const better = (x, y) => (+!!x.must_see - +!!y.must_see) || (+x.has_img - +y.has_img) || (len(x.description_he) - len(y.description_he)) || (x.score - y.score) || (y.id - x.id);

let mergedClusters = 0, dropped = 0;
const client = APPLY ? await pool.connect() : null;
if (APPLY) await client.query("BEGIN");
try {
  for (const c of dupes) {
    const keeper = c.slice().sort((a, b) => better(b, a))[0];
    const drops = c.filter((r) => r.id !== keeper.id);
    console.log(`${keeper.city}: ${c.length}× "${keeper.name_he || keeper.name_en}" (${keeper.name_en})  keep ${keeper.id}  drop ${drops.map(d=>d.id).join(",")}  [${c.map(r=>r.name_he).join(" | ")}]`);
    if (APPLY) {
      const bestImg = c.map(r=>r.image_url).filter(x=>x&&x!=="")[0] || null;
      const bestDesc = c.map(r=>r.description_he).filter(Boolean).sort((a,b)=>b.length-a.length)[0] || null;
      const bestTag = c.map(r=>r.tagline_he).filter(Boolean).sort((a,b)=>b.length-a.length)[0] || null;
      if (bestImg && !keeper.has_img) await client.query(`UPDATE attractions SET image_url=$2 WHERE id=$1`, [keeper.id, bestImg]);
      if (bestDesc && len(bestDesc) > len(keeper.description_he)) await client.query(`UPDATE attractions SET description_he=$2 WHERE id=$1`, [keeper.id, bestDesc]);
      if (bestTag && len(bestTag) > len(keeper.tagline_he)) await client.query(`UPDATE attractions SET tagline_he=$2 WHERE id=$1`, [keeper.id, bestTag]);
      const ids = drops.map(d=>d.id);
      await client.query(`UPDATE insights SET attraction_id=$1 WHERE attraction_id = ANY($2)`, [keeper.id, ids]);
      await client.query(`DELETE FROM editor_picks WHERE attraction_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM attraction_edges WHERE from_id = ANY($1) OR to_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM attractions WHERE id = ANY($1)`, [ids]);
    }
    mergedClusters++; dropped += drops.length;
  }
  if (APPLY) await client.query("COMMIT");
} catch (e) { if (APPLY) await client.query("ROLLBACK"); console.error("ROLLED BACK:", e.message); process.exitCode = 1; }
finally { if (client) client.release(); }
console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — clusters=${mergedClusters}  rows_to_delete=${dropped}`);
await pool.end();
