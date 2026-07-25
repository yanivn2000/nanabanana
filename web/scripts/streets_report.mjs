// Post-seed report: streets per city + geometry sanity.
import { readFileSync } from "node:fs"; import pg from "pg";
const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const rows = (await c.query(`
  select d.name_en, count(s.id) n,
    count(s.id) filter (where s.geometry is not null) with_geo,
    count(s.id) filter (where s.area_id is not null) linked,
    round(avg(s.length_m)) avg_len
  from destinations d left join streets s on s.destination_id=d.id
  group by d.id, d.name_en having count(s.id) > 0 order by d.name_en`)).rows;
let tot = 0;
for (const r of rows) { tot += +r.n; console.log(`${r.name_en.padEnd(16)} ${String(r.n).padStart(3)} streets · ${r.with_geo} geo · ${r.linked} area-linked · avg ${r.avg_len||0}m`); }
console.log(`\n${rows.length} cities · ${tot} streets total`);
await c.end();
