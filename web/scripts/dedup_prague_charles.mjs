// Merge the Prague Charles Bridge spelling-variant duplicates (גשר קארל / קרל /
// קרלוב) that the exact-name dedup missed. Keep 21797 (has description+image),
// fold insights, delete the two variants. 63200 is 11km away (distinct) — left.
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const KEEP = 21797, DROP = [22024, 21904];
try {
  await c.query("BEGIN");
  await c.query(`UPDATE insights SET attraction_id=$1 WHERE attraction_id = ANY($2)`, [KEEP, DROP]);
  await c.query(`DELETE FROM editor_picks WHERE attraction_id = ANY($1)`, [DROP]);
  await c.query(`DELETE FROM attraction_edges WHERE from_id = ANY($1) OR to_id = ANY($1)`, [DROP]);
  await c.query(`DELETE FROM attractions WHERE id = ANY($1)`, [DROP]);
  await c.query("COMMIT");
  const g = await c.query(`SELECT count(*)::int n FROM attractions WHERE id = ANY($1)`, [DROP]);
  console.log("dropped still present (want 0):", g.rows[0].n);
} catch (e) { await c.query("ROLLBACK"); console.error("ROLLED BACK:", e.message); process.exitCode = 1; }
await c.end();
