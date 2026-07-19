-- Phase 11 — neighbourhoods as first-class areas. A trip isn't only "which
-- places" but "which parts of the city" — a half-day wandering Shoreditch's
-- market and cool shops, a Greenwich morning. Areas make that a real, offerable
-- unit: each has a character, what it's good for, and a "gateway" (how you get
-- there from the centre), so the builder can propose a neighbourhood day and an
-- isolated-but-special place can earn its own area day.
--
-- Areas are discovered by geographic clustering (DBSCAN over attraction density)
-- and then named/described by the agent (no paid API), editor-approved in admin.
create table if not exists areas (
  id                serial primary key,
  destination_id    integer references destinations(id),
  name_he           text,
  name_en           text,
  lat               double precision,   -- centroid
  lng               double precision,
  radius_m          integer,            -- rough extent (max member distance from centroid)
  vibe_he           text,               -- the character, in Hebrew
  best_for          text[],             -- 'שוק' | 'וינטג'' | 'מוזיאונים' | 'חיי לילה' | 'אוכל' …
  gateway_he        text,               -- "קחו Overground ל-Haggerston (~15 דק')"
  attraction_count  integer,
  source            text default 'dbscan',
  approved          boolean default false,
  created_at        timestamptz default now()
);
create index if not exists idx_areas_dest on areas(destination_id);

-- Which area an attraction sits in (null = not in any dense cluster / noise).
alter table attractions add column if not exists area_id integer references areas(id);
create index if not exists idx_attr_area on attractions(area_id);
