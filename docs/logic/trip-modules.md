# Trip modules ("משבצות") — reusable editor-approved blocks

**Goal:** a library of trusted, editor-approved regional blocks that compose into
full trips, so a traveller starts from a vetted base instead of a blank build —
and so we can grow many sub-trips / whole trips we stand behind.

## Model
`trip_templates` (supabase/phase14.sql): a saved `Itinerary` block for a region —
`destination_id`, `region`, `title_he`, `audience`, `days`, `itinerary` (jsonb,
car legs and all), `source_urls`, `approved`, `created_by`. A module is just a
built trip that an editor approved and named.

## How a module is created (today)
In the admin **🧠 המוח** tab: run the Brain self-eval for a city, review the trip
(open it as a real trip page with map), and click **“משבצת”** to save it as an
approved block. `SALZBURG_SOURCES` (masa.co.il articles) are attached so the block
records what Israeli travel media it's grounded in. The library lists all saved
modules with their source count; delete removes one.

## Grounding
Modules are built by the deterministic Brain ([[brain]]) over the enriched DB, and
validated against real Israeli travel sources. The first module — **Salzburg, 2
days** — was cross-checked against masa.co.il's Salzburg articles (top-10,
with-kids, region day-trips): Day 1 = Old Town on foot (Hohensalzburg, Mozart,
Mirabell, Haus der Natur), Day 2 = a car day-trip (Königssee / Berchtesgaden salt
mine / Eisriesenwelt). Car legs throughout, since Salzburg is a rental-car base
([[mobility-profile]] / docs/logic/mobility.md).

## Next
- **Compose**: the multi-city Austria builder offers approved modules as segments
  (`buildMultiHeuristicItinerary` already concatenates ordered city segments — a
  module becomes a ready-made segment).
- Per-audience variants; editor edit-before-save; a consumer-facing "start from a
  ready trip" entry. Links: [[project_community]] (approved trips → shareable
  library), [[project_the_brain]].
