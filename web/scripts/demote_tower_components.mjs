// The Tower of London complex was split into several must-see rows; the builder
// picked a thin sub-part (White Tower, 82-char stub) over the rich parent entry
// (מגדל לונדון, 398 chars). Mark the sub-parts as components so they drop out of
// the must-see pool + city list, leaving the parent as the shown attraction.
// (Tower Bridge is a separate landmark — untouched.)
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const COMPONENTS = [26147, 26148, 26271]; // White Tower, Waterloo Block, Ravens Enclosure
const r = await c.query(`UPDATE attractions SET is_component = 1 WHERE id = ANY($1) RETURNING id, name_he`, [COMPONENTS]);
console.log("demoted:", JSON.stringify(r.rows));
await c.end();
