// READ-ONLY. List worthy same-name clusters with per-row assets + pairwise distance,
// so we can tell true duplicates (same spot) from distinct places sharing a name.
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (t, p) => pool.query(t, p).then(r => r.rows);
const EFF = `CASE WHEN ep.rank IS NOT NULL THEN (ep.rank='must')::int ELSE a.must_see END`;
const J = `LEFT JOIN editor_picks ep ON ep.attraction_id=a.id AND ep.destination_id=a.destination_id`;

const rows = await q(`
  WITH n AS (
    SELECT a.id, a.destination_id, a.lat, a.lng,
      lower(regexp_replace(COALESCE(NULLIF(a.name_he,''),a.name_en),'[^0-9a-zA-Zא-ת]','','g')) norm,
      COALESCE(NULLIF(a.name_he,''),a.name_en) disp,
      (${EFF}=1) mustsee,
      (a.image_url IS NOT NULL AND a.image_url<>'') has_img,
      char_length(COALESCE(a.description_he,'')) dlen,
      COALESCE(a.family_score,0) score
    FROM attractions a ${J})
  SELECT COALESCE(d.city_he,d.city) city, n.norm,
    json_agg(json_build_object('id',n.id,'lat',n.lat,'lng',n.lng,'must',n.mustsee,'img',n.has_img,'dlen',n.dlen,'score',n.score) ORDER BY n.id) rows,
    (array_agg(n.disp))[1] name
  FROM n JOIN destinations d ON d.id=n.destination_id
  WHERE char_length(n.norm)>2
  GROUP BY d.id, city, n.norm
  HAVING COUNT(*)>1 AND (SUM(n.mustsee::int)>=1 OR SUM(n.has_img::int)>=1 OR SUM((n.dlen>40)::int)>=1)`, []);

const hav = (a, b) => { const R=6371000, t=x=>x*Math.PI/180;
  const dLat=t(b.lat-a.lat), dLng=t(b.lng-a.lng);
  const s=Math.sin(dLat/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.asin(Math.sqrt(s))); };

let close = 0, spread = 0;
for (const c of rows) {
  const rs = c.rows;
  const maxD = Math.max(...rs.flatMap((a,i)=>rs.slice(i+1).map(b=>hav(a,b))));
  const tag = maxD <= 150 ? "SAME" : "SPREAD";
  if (maxD <= 150) close++; else spread++;
  console.log(`${tag} ${maxD}m  ${c.city}: ${rs.length}× "${c.name}"  ids=${rs.map(r=>r.id).join(",")}  img=${rs.filter(r=>r.img).length} must=${rs.filter(r=>r.must).length}`);
}
console.log(`\nclusters=${rows.length}  SAME(≤150m, mergeable)=${close}  SPREAD(distinct, leave)=${spread}`);
await pool.end();
