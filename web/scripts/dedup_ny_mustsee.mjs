// One-off: merge the 3 New York must-see duplicate pairs found in the 2026-08-01
// content audit. Keeps the richer row, folds the other's image/insights in, then
// deletes the duplicate. Transactional — rolls back on any error. Read the audit
// (project_content_audit_live) for why each keeper was chosen.
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const merges = [
  { keep: 119766, drop: 122239, copyImage: true },   // Rockefeller Center — keep the 518-char desc + 5 edges, take image
  { keep: 119832, drop: 120891, copyImage: false },  // Brooklyn Heights Promenade — keep the one with 3 insights
  { keep: 120536, drop: 120531, copyImage: false },  // Gantry Plaza — keep image + score 9
];

try {
  await c.query("BEGIN");
  for (const m of merges) {
    if (m.copyImage) {
      await c.query(
        `UPDATE attractions k SET image_url = d.image_url
           FROM attractions d
          WHERE k.id=$1 AND d.id=$2
            AND (k.image_url IS NULL OR k.image_url='')
            AND d.image_url IS NOT NULL AND d.image_url<>''`, [m.keep, m.drop]);
    }
    await c.query(`UPDATE insights SET attraction_id=$1 WHERE attraction_id=$2`, [m.keep, m.drop]);
    await c.query(`DELETE FROM editor_picks WHERE attraction_id=$1`, [m.drop]);
    await c.query(`DELETE FROM attraction_edges WHERE from_id=$1 OR to_id=$1`, [m.drop]);
    await c.query(`DELETE FROM attractions WHERE id=$1`, [m.drop]);
  }
  await c.query("COMMIT");
  const kept = await c.query(
    `SELECT id, (image_url IS NOT NULL AND image_url<>'') has_img,
       (SELECT count(*) FROM insights i WHERE i.attraction_id=attractions.id) insights
       FROM attractions WHERE id = ANY($1) ORDER BY id`, [[119766, 119832, 120536]]);
  const gone = await c.query(`SELECT count(*)::int g FROM attractions WHERE id = ANY($1)`, [[122239, 120891, 120531]]);
  console.log("KEPT:", JSON.stringify(kept.rows));
  console.log("dropped still present (want 0):", gone.rows[0].g);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLED BACK:", e.message);
  process.exitCode = 1;
}
await c.end();
