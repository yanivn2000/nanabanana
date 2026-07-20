# Per-city travel profile (mobility)

**Problem:** ingest used a fixed radius (30km cap in `app.py`), so a base town's
famous day-trips were never pulled. Salzburg's Liechtensteinklamm (~57km), the
Mountain-Gokart and their access road sit outside 30km — they simply never
entered the DB. But "how far is worth visiting" is **city-dependent**:

- **metro** (London, Paris, Vienna, Rome…): a walk/transit trip. Nobody drives
  60km out; the trip lives inside the city. Tight radius (~25km).
- **car_base** (Salzburg, Brașov, Crete, Rhodes, Cyprus, Batumi, Nice…): a car
  **star trip** (טיול כוכב) — rent a car, sleep in one base, day-trip 50–120km
  out. The gorge/castle/coast an hour away is the point. Wide radius.

## The model
`destinations.mobility` ('metro' | 'car_base') + `destinations.ingest_radius_km`
(see `supabase/phase13.sql`). The radius drives OSM ingest; the mobility type is
also the hook for the builder (walk-day vs car-day-trip) and the map's default
extent.

Current car_base radii: Salzburg 80 · Brașov 90 · Rhodes 90 · Crete 120 · Batumi
70 · Larnaca 70 · Paphos 70 · Nice 60 · Lefkada 50. All others metro @ 25.
Editorial defaults — tunable per city.

## Ingest
`pipeline_osm.fetch_city(city, country, lat, lng, radius_km)` (Overpass, **free**)
upserts by `(osm_type, osm_id)`, so re-running a car_base city at its wider
radius only adds the new far attractions — existing rows are untouched. No
duplicates. Re-ingest a car_base city whenever its radius changes.

## Builder safety (staged)
Newly ingested far attractions start **unscored** (`audience_fit` null), so the
walk-based day-clusterer never auto-selects a 55km gorge into a walking day — it
only picks scored must-sees / high-fit places. That makes ingest a safe staging
step. Surfacing car day-trips *properly* (a car travel-leg, a "day trip" day
distinct from walkable days) is the follow-on that the `mobility='car_base'`
flag enables — see [[transport-edges]] / [day-clustering.md](./day-clustering.md).
Until then, far attractions are visible in admin but won't corrupt auto-built
walking days.
