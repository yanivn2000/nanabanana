# Neighbourhoods logic — areas as a first-class unit

**Kind:** hybrid — deterministic **discovery** + agent-judgment **authoring**.
Canonical code: DB `areas` + `attractions.area_id` (schema `supabase/phase11.sql`),
[`web/lib/cluster.ts`](../../web/lib/cluster.ts) `annotateDaysWithAreas`,
[`web/lib/db.ts`](../../web/lib/db.ts) (`areasForDestination`, `updateArea`,
`areaAttractions`), admin tab `web/app/admin/AreasTable.tsx`. Reproducible scripts:
`web/scripts/areas_discover.mjs`, `web/scripts/areas_write.mjs`.

## Why this exists
A trip isn't only "which places" but "which parts of the city" — a half-day
wandering a neighbourhood (Greenwich, Camden), reached by a train "gateway". Areas
make that offerable, and give an isolated-but-special place a home (its own area
day). They also make the plan legible: each day is framed as a neighbourhood.

## Step 1 — discovery (deterministic, `areas_discover.mjs`)
Cluster the city's **visit-worthy** attractions (must_see=1 OR
`audience_fit.couples ≥ 50`) with **k-means** (k≈16, k-means++ init, Lloyd
iterations), then **drop clusters with < 3 members** (a neighbourhood needs a few
worthy places). Output per cluster: centroid, radius (max member distance),
member ids, top sample names.

**Why k-means, not DBSCAN:** DBSCAN was tried first and failed — central London is
one *contiguous* dense mass, so at eps=500 m everything chained into a single
3952-POI blob; and the raw ~5000 London POIs are mostly trivia (memorial benches,
community gardens). k-means over the *worthy* set partitions the contiguous centre
into real sub-areas and ignores the trivia. Tune k per city so the centre splits
into recognisable neighbourhoods without fragmenting.

## Step 2 — authoring (AGENT judgment, no paid API)
For each discovered cluster, a Claude session (reading this spec) writes, from the
centroid location + member attractions + its own geographic knowledge:
- `name_he` / `name_en` — the real neighbourhood name (Westminster, גריניץ',
  Camden…). Not "Cluster 3".
- `vibe_he` — 1–2 sentences of character (what it feels like, its signature).
- `best_for` — 2–4 Hebrew tags (שווקים / מוזיאונים / וינטג' / חיי לילה / משפחות …).
- `gateway_he` — how to get there **from the city centre** ("קו Northern ל-Camden
  Town, ~10 דק'"). Central areas can still have one; it's only *shown* when the
  area is out of centre (see annotation).

Guidance: name by the dominant real neighbourhood even if the cluster spans two;
keep vibe concrete and specific, not generic; gateway names the actual line/mode.

Then `areas_write.mjs` inserts the areas (`source='kmeans'`, `approved=false`),
sets `attractions.area_id` for the members, defaults `kind='landmark'`, and marks
`headline=true` for the 2 biggest areas + any with ≥6 attractions (the author json
may override `kind`/`headline` per area). `kind`/`headline` drive the city-page
strip (see phase12 + `headlineAreasForCity`); the editor refines in the admin.

## Step 3 — editor approval (admin)
`🗺️ שכונות` tab: spatial mini-map (size = attraction count, green = approved /
amber = pending), an editable card per area (name / vibe / best_for / gateway),
an **approve** toggle, and an expandable **attraction list** per area so the editor
can verify the auto-assignment and spot mistakes (wrong-city or duplicate rows).

## Step 4 — use in the build (annotation)
`annotateDaysWithAreas(days, areas, center)` labels each **already-built** day with
the nearest area it falls in (by day-centroid, within the area's radius + 600 m),
and adds the `gateway` **only** when the area centroid is **> 2.5 km** from the city
centre ("you don't tell someone to take the train to where they already are").
Shown in the trip as a day area badge + a "איך מגיעים לאזור" gateway strip.

## Running it for a new city
1. `node web/scripts/areas_discover.mjs <destId> [k] > /tmp/clusters.json` (DB only)
2. **Apply this spec yourself:** read `/tmp/clusters.json`, author name/vibe/
   best_for/gateway per cluster → `/tmp/areas.json` (array aligned to clusters).
3. `node web/scripts/areas_write.mjs <destId> /tmp/areas.json` (DB only)
4. Review + approve in the admin.

## Known gaps / next
- **Vibe areas** (Shoreditch/Haggerston) don't emerge — their appeal is
  market/streets/cafés, not must-see POIs, so they're absent from the worthy set.
  Needs long-tail inclusion or a curated seed.
- Areas only LABEL built days; they don't yet SEED an isolated-but-special area day.
- The build uses ALL areas; wire the `approved` filter when it matters.
- Discovered for London only so far — roll out per city with the steps above.
