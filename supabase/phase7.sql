-- Phase 7 — sub-attraction ("component") detection.
-- Generic POIs (subcategory='attraction') that sit inside a parent venue
-- (zoo/theme_park/water_park/aquarium) are components — zoo animals, rides,
-- aquarium tanks. is_component=1 hides them from the consumer app (reversible;
-- the admin flags them after review). NULL/0 = a real standalone attraction.
alter table attractions add column if not exists is_component smallint;
create index if not exists idx_attr_component on attractions(is_component);
