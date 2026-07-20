-- Per-city travel profile: how far the "worth visiting" set extends depends on
-- the city's mobility, not a fixed radius. A dense metro (London/Paris) is a
-- walk/transit trip — nobody drives 60km. A base town (Salzburg, Brașov) is a
-- car "star trip" (טיול כוכב) where 50–100km day-trips are the whole point.
--
--   mobility        — 'metro' (walk/transit, tight) | 'car_base' (car star-trip, wide)
--   ingest_radius_km — how far OSM ingest pulls attractions from the center.
alter table destinations add column if not exists mobility text not null default 'metro';
alter table destinations add column if not exists ingest_radius_km integer not null default 25;
