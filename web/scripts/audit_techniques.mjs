// Anti-drift guard for the Brain's tunables. Scans the engine files for named
// numeric constants and flags any that aren't classified — so a value that should
// be an editor TECHNIQUE doesn't quietly stay hardcoded (half-transparent system).
// See web/CLAUDE.md + docs/logic/techniques.md. Run: node web/scripts/audit_techniques.mjs
import { readFileSync } from "node:fs";

const FILES = [
  "lib/heuristic.ts", "lib/cluster.ts", "lib/daytrips.ts", "lib/brain/critique.ts", "lib/geo.ts",
];

// Every named numeric constant in the engine must be classified as either a
// technique fallback (`fallback:<kind>`) or a deliberate engine internal (`engine …`).
// Anything not here is flagged for review — expose it as a technique or classify it.
const KNOWN = {
  DAY_START_MIN: "fallback:day_window", LUNCH_AFTER_MIN: "fallback:lunch", LUNCH_MIN: "fallback:lunch",
  VISIT_DEFAULT: "fallback:visit_default", VISIT_MIN: "engine (visit clamp)", VISIT_MAX: "engine (visit clamp)",
  CANDIDATES_PER_DAY: "engine (tour seeding)", FREE_DETOUR: "fallback:free_gems", FREE_MAX_PER_DAY: "fallback:free_gems",
  IN_CITY_KM: "fallback:daytrip_threshold", DRIVE_KMH: "engine (drive-time model)",
  CLUSTER_KM: "engine (far-area tightness)", MAX_STOPS_PER_TRIP: "fallback:daytrip_max_stops",
  WALK_MIN_PER_KM: "engine (walk-speed model)", DEFAULT_WALK_PREF: "engine (walkPref default)",
};

const RX = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*=\s*([^;]*\d[^;]*);/gm;
let flagged = 0, total = 0;
for (const f of FILES) {
  let src;
  try { src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8"); } catch { continue; }
  const rows = [];
  for (const m of src.matchAll(RX)) {
    const name = m[1], val = m[2].trim().slice(0, 40);
    const cls = KNOWN[name];
    total++;
    if (!cls) flagged++;
    rows.push(`  ${cls ? "✓" : "⚠️ "} ${name} = ${val}   ${cls ?? "UNCLASSIFIED — expose as technique or classify"}`);
  }
  if (rows.length) console.log(`\n${f}`), rows.forEach((r) => console.log(r));
}
console.log(`\n${total} engine constants · ${flagged} unclassified`);
if (flagged) console.log("→ classify each: add a technique (rules.ts) or mark it engine-internal in this script's KNOWN map.");
