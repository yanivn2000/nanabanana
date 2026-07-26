// Add food / vintage_shopping taste_tags to MARKETS the conservative taste_tag.py
// skipped — chiefly markets mis-categorised as generic "attraction" (Albert Cuyp,
// Chelsea Market…), so they surface for the "אוכל ושווקים" / "קניות" interests by
// RANKING, not only by the reservation's name-keyword. Idempotent (only adds).
//
//   node web/scripts/tag_markets.mjs         # dry run — preview
//   node web/scripts/tag_markets.mjs --apply
import { readFileSync } from "node:fs"; import pg from "pg";
const APPLY = process.argv.includes("--apply");
const url = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

// A real FOOD market (produce/food halls). A FLEA/antique/stamp market → vintage_shopping.
const FOOD = /albert cuyp|chelsea market|carmel|kapani|de hallen|naschmarkt|boqueria|borough market|mahane ?yehuda|markthal|market hall|food hall|central market|mercado central|mercato centrale|mercado|mercat |mercato|marché|grand bazaar|כרמל|מחנה יהודה|נאשמרקט|שוק האוכל|שוק אוכל|השוק המרכזי|שוק מרכזי/i;
const FLEA = /\bflea\b|puces|petticoat|porta portese|dry bridge|\bstamp market\b|\bantique|פשפשים|בולים|וינטג|יד ?שנייה/i;
// Names that merely CONTAIN "שוק"/"market" but are NOT a market — never tag these.
const EXCLUDE = /שוקת|שוקולט|שוקרט|שטולפרשטיין|main square|market square|כיכר|\bpark\b|\bgarden\b|jardim|miradouro|plaque|commemorat|centenari|aniversari|trough|replanting|cattle|stolperstein|מחסום|מיקום|ההיסטורי|amplasament|vechea|fosta|macellum|trajan|טראיאנוס/i;
// Ancient ruins / non-commercial categories are never a live shopping/food market.
const badSub = (s) => s === "archaeological_site" || s === "monument" || s === "city_gate" || s === "memorial";

const rows = (await c.query(`select id,name_he,name_en,category,subcategory,taste_tags from attractions
  where subcategory in ('market','marketplace') or name_he like '%שוק%' or name_en ~* 'market|bazaar|mercado|mercat|mercato|marché|flea'`)).rows;

let food = 0, flea = 0, skip = 0;
const changes = [];
for (const a of rows) {
  const hay = `${a.name_he || ""} ${a.name_en || ""}`;
  if (EXCLUDE.test(hay) || badSub(a.subcategory)) { skip++; continue; }
  const isMarketSub = a.subcategory === "market" || a.subcategory === "marketplace";
  // Name-based tagging applies only to live commercial categories — a park/memorial/
  // viewpoint that merely sits at a "mercado" is not itself a market.
  const nameOk = ["attraction", "shopping", "tourism"].includes(a.category);
  const tags = new Set(Array.isArray(a.taste_tags) ? a.taste_tags : []);
  const before = tags.size;
  // subcategory-tagged markets are both eat-and-shop destinations.
  if (isMarketSub) { tags.add("food"); tags.add("vintage_shopping"); }
  if (nameOk && FOOD.test(hay)) tags.add("food");
  if (nameOk && FLEA.test(hay)) tags.add("vintage_shopping");
  // a bare "שוק …"/"… market" in a generic commercial category with no food/flea
  // signal → treat as a shopping market (vintage_shopping). Conservative.
  if (!isMarketSub && nameOk && !FOOD.test(hay) && !FLEA.test(hay)
      && /שוק|market|bazaar|merca|marché/i.test(hay)) {
    tags.add("vintage_shopping");
  }
  if (tags.size === before) continue;
  const added = [...tags].filter((t) => !(a.taste_tags || []).includes(t));
  if (added.includes("food")) food++;
  if (added.includes("vintage_shopping") && !added.includes("food")) flea++;
  changes.push({ id: a.id, name: a.name_he || a.name_en, cat: `${a.category}/${a.subcategory}`, added, tags: [...tags] });
}

console.log(`${changes.length} markets to tag (skipped ${skip} false-positives). +food-ish=${food}`);
for (const ch of changes) console.log(`  [${ch.cat}] ${ch.name} +[${ch.added.join(",")}]`);
if (APPLY) {
  for (const ch of changes) await c.query(`update attractions set taste_tags=$1 where id=$2`, [JSON.stringify(ch.tags), ch.id]);
  console.log(`\nAPPLIED ${changes.length} updates.`);
} else {
  console.log(`\n[dry run] pass --apply to write.`);
}
await c.end();
