// Merge worthy same-name clusters whose members are all within 150m (same physical
// place split into duplicate OSM rows). Distinct places sharing a name (>150m apart)
// are left untouched. Keeper = richest row; folds image/description/tagline/insights
// in, then deletes the duplicates. Transactional. From the 2026-08-01 content audit.
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = (t, p) => c.query(t, p).then(r => r.rows);
const EFF = `CASE WHEN ep.rank IS NOT NULL THEN (ep.rank='must')::int ELSE a.must_see END`;
const J = `LEFT JOIN editor_picks ep ON ep.attraction_id=a.id AND ep.destination_id=a.destination_id`;

const clusters = await q(`
  WITH n AS (
    SELECT a.id, a.destination_id, a.lat, a.lng, a.image_url, a.description_he, a.tagline_he,
      lower(regexp_replace(COALESCE(NULLIF(a.name_he,''),a.name_en),'[^0-9a-zA-Zא-ת]','','g')) norm,
      (${EFF}=1) mustsee, COALESCE(a.family_score,0) score
    FROM attractions a ${J})
  SELECT n.destination_id, n.norm,
    json_agg(json_build_object('id',n.id,'lat',n.lat,'lng',n.lng,
      'img',n.image_url,'desc',n.description_he,'tag',n.tagline_he,'must',n.mustsee,'score',n.score) ORDER BY n.id) rows
  FROM n
  WHERE char_length(n.norm)>2
  GROUP BY n.destination_id, n.norm
  HAVING COUNT(*)>1 AND (SUM(n.mustsee::int)>=1 OR SUM((n.image_url IS NOT NULL AND n.image_url<>'')::int)>=1 OR SUM((char_length(COALESCE(n.description_he,''))>40)::int)>=1)`, []);

const hav = (a, b) => { const R=6371000, t=x=>x*Math.PI/180;
  const s=Math.sin(t(b.lat-a.lat)/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(t(b.lng-a.lng)/2)**2;
  return R*2*Math.asin(Math.sqrt(s)); };
const len = s => (s ? s.length : 0);
const better = (x, y) => // is x a better keeper than y?
  (+!!x.must - +!!y.must) || (+(!!x.img&&x.img) - +(!!y.img&&y.img)) ||
  (len(x.desc) - len(y.desc)) || (x.score - y.score) || (y.id - x.id);

let merged = 0, dropped = 0;
try {
  await c.query("BEGIN");
  for (const cl of clusters) {
    const rs = cl.rows;
    const maxD = Math.max(...rs.flatMap((a,i)=>rs.slice(i+1).map(b=>hav(a,b))));
    if (maxD > 150) continue;                       // distinct places → skip
    const keeper = rs.slice().sort((a,b)=>better(b,a))[0];
    const drops = rs.filter(r => r.id !== keeper.id);
    const bestImg = rs.map(r=>r.img).filter(x=>x && x!=="")[0] || null;
    const bestDesc = rs.map(r=>r.desc).filter(Boolean).sort((a,b)=>b.length-a.length)[0] || null;
    const bestTag = rs.map(r=>r.tag).filter(Boolean).sort((a,b)=>b.length-a.length)[0] || null;
    if (bestImg && !(keeper.img && keeper.img!=="")) await c.query(`UPDATE attractions SET image_url=$2 WHERE id=$1`, [keeper.id, bestImg]);
    if (bestDesc && len(bestDesc) > len(keeper.desc)) await c.query(`UPDATE attractions SET description_he=$2 WHERE id=$1`, [keeper.id, bestDesc]);
    if (bestTag && len(bestTag) > len(keeper.tag)) await c.query(`UPDATE attractions SET tagline_he=$2 WHERE id=$1`, [keeper.id, bestTag]);
    const dropIds = drops.map(d=>d.id);
    await c.query(`UPDATE insights SET attraction_id=$1 WHERE attraction_id = ANY($2)`, [keeper.id, dropIds]);
    await c.query(`DELETE FROM editor_picks WHERE attraction_id = ANY($1)`, [dropIds]);
    await c.query(`DELETE FROM attraction_edges WHERE from_id = ANY($1) OR to_id = ANY($1)`, [dropIds]);
    await c.query(`DELETE FROM attractions WHERE id = ANY($1)`, [dropIds]);
    merged++; dropped += dropIds.length;
    console.log(`merged ${cl.rows.length}× (kept ${keeper.id}, dropped ${dropIds.join(",")})`);
  }
  await c.query("COMMIT");
  console.log(`\nDONE — merged ${merged} clusters, deleted ${dropped} duplicate rows.`);
} catch (e) { await c.query("ROLLBACK"); console.error("ROLLED BACK:", e.message); process.exitCode = 1; }
await c.end();
