// Landmark dedup — same single landmark split across two rows. Looser than
// dedup_near.mjs (which is <=10m + near-exact names) but HIGH PRECISION on purpose.
//   node web/scripts/dedup_landmark.mjs               # report (dry run)
//   node web/scripts/dedup_landmark.mjs --fix <ids>   # delete ONLY these loser ids
//
// A "same landmark" pair = within 60m AND one name's word-set is contained in the
// other's, differing only by a counter / spelling / a subtitle. Type words (פארק,
// אנדרטה, גשר, טירת…) are NEVER stripped, so "park of X" vs "statue of X" and
// "castle" vs "bridge of X" stay DISTINCT — the collateral damage a token-overlap
// rule caused. It is still a detector: a human reviews and passes chosen ids to --fix.
import { readFileSync } from "node:fs";
import pg from "pg";

const FIX = process.argv.includes("--fix");
const fixIds = new Set(process.argv.slice(process.argv.indexOf("--fix") + 1).map(Number).filter(Boolean));
const RADIUS = 60; // metres — same spot; distinct siblings (parks, palaces) stay apart

const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const hav = (a, g, b, h) => { const R = 6371000, dLa = (b - a) * Math.PI / 180, dLo = (h - g) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(b * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const cityNames = new Set((await c.query(`select city_he from destinations where city_he is not null`)).rows
  .map((r) => r.city_he).concat((await c.query(`select city from destinations`)).rows.map((r) => r.city)));
const dests = new Map((await c.query(`select id, coalesce(city_he, city) name from destinations`)).rows.map((r) => [r.id, r.name]));

const A = (await c.query(`select id, name_he, destination_id, lat, lng,
  coalesce(must_see,0) ms, (image_url is not null) img, (audience_fit is not null) af
  from attractions where name_he is not null and lat is not null and lng is not null`)).rows;

// Collapse spelling noise: niqqud, doubled vav/yod, final-form letters.
const collapse = (t) => t
  .replace(/[֑-ׇ]/g, "")
  .replace(/וו+/g, "ו").replace(/יי+/g, "י")
  .replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ").replace(/ף/g, "פ").replace(/ץ/g, "צ");
// Canonical form of a whole name: drop the city, a "(2)/(שני/שנייה/נוסף)" counter,
// squeeze spaces, collapse spelling. TYPE WORDS SURVIVE — that's the safety.
const norm = (s) => {
  let t = s;
  for (const city of cityNames) if (city && city.length >= 3) t = t.split(city).join(" ");
  t = t.replace(/\(\s*(\d+|שני|שנייה|שני'|ב'|נוסף|נוספת|דרומי|צפוני)\s*\)/g, " ")
       .replace(/[(),.]/g, " ").replace(/[—–\-]/g, " ").replace(/\s+/g, " ").trim();
  return collapse(t.toLowerCase());
};
const wordset = (s) => new Set(norm(s).split(/\s+/).filter((w) => w.length >= 2));
// A remainder that is JUST a type/qualifier word doesn't identify a distinct place.
const GENERIC = new Set(["פארק", "פארקו", "גנ", "גני", "מוזיאונ", "בית", "כיכר", "ארמונ", "כנסיית",
  "קתדרלת", "גשר", "מגדל", "טירת", "טירה", "בזיליקת", "מזרקת", "מזרקה", "פסל", "אנדרטה", "אנדרטת",
  "מרכז", "תצפית", "רובע", "שכונת", "שוק", "של", "המלכותי", "הלאומי", "הלאומית", "הגדול", "הגדולה"]);
const genericOnly = (set) => set.size > 0 && [...set].every((w) => GENERIC.has(w));

const score = (x) => (x.ms ? 4 : 0) + (x.img ? 2 : 0) + (x.af ? 1 : 0);
const byDest = new Map();
for (const a of A) { (byDest.get(a.destination_id) ?? byDest.set(a.destination_id, []).get(a.destination_id)).push(a); a._n = norm(a.name_he); a._w = wordset(a.name_he); }

const pairs = [];
for (const [dest, list] of byDest) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (hav(a.lat, a.lng, b.lat, b.lng) > RADIUS) continue;
    const same = a._n === b._n && a._n.length > 0;
    const [sm, big] = a._w.size <= b._w.size ? [a, b] : [b, a];
    const contained = sm._w.size > 0 && [...sm._w].every((w) => big._w.has(w));
    const extra = new Set([...big._w].filter((w) => !sm._w.has(w)));
    if (!same && !(contained && extra.size >= 1)) continue;
    if (genericOnly(sm._w)) continue;                 // shared core must identify a place
    const d = Math.round(hav(a.lat, a.lng, b.lat, b.lng));
    const loser = score(a) >= score(b) ? b : a, keeper = loser === a ? b : a;
    // exact/type-suffix = near-certain dup; sub-feature = the extra words name a real
    // part (a gallery inside a museum) → likely-merge but flag for a second look.
    const conf = same ? "exact" : (genericOnly(extra) ? "type-suffix" : "sub-feature");
    pairs.push({ dest, d, keeper, loser, conf });
  }
}
const rank = { exact: 0, "type-suffix": 1, "sub-feature": 2 };
pairs.sort((x, y) => rank[x.conf] - rank[y.conf] || x.dest - y.dest || x.d - y.d);

if (!FIX) {
  const n = (k) => pairs.filter((p) => p.conf === k).length;
  console.log(`landmark-dup candidates (<=${RADIUS}m, containment): ${pairs.length}  (exact ${n("exact")} · type-suffix ${n("type-suffix")} · sub-feature ${n("sub-feature")})\n`);
  for (const p of pairs)
    console.log(`[${p.conf}] [${dests.get(p.dest)}] ${p.d}m  KEEP #${p.keeper.id} "${p.keeper.name_he}"  ⟵ DEL #${p.loser.id} "${p.loser.name_he}"`);
  console.log(`\n(dry run) review, then: node web/scripts/dedup_landmark.mjs --fix <loser-id> ...`);
  await c.end(); process.exit(0);
}

const chosen = pairs.filter((p) => fixIds.has(p.loser.id));
if (!chosen.length) { console.log("no candidate pairs match the given ids — nothing to do."); await c.end(); process.exit(0); }
for (const p of chosen) {
  await c.query(`update insights set attraction_id=$1 where attraction_id=$2`, [p.keeper.id, p.loser.id]).catch(() => {});
  await c.query(`delete from editor_picks where attraction_id=$1`, [p.loser.id]).catch(() => {});
  await c.query(`delete from attractions where id=$1`, [p.loser.id]);
  console.log(`✔ [${dests.get(p.dest)}] kept "${p.keeper.name_he}" ← removed "${p.loser.name_he}"`);
}
const affected = [...new Set(chosen.map((p) => p.dest))];
for (const d of affected) await c.query(`update areas a set attraction_count=(select count(*) from attractions t where t.area_id=a.id) where a.destination_id=$1`, [d]);
console.log(`\n✔ removed ${chosen.length} landmark-dup rows · resynced areas for ${affected.length} cities`);
await c.end();
