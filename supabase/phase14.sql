-- Trip modules ("משבצות"): editor-approved, reusable itinerary blocks for a region.
-- A base town's 1-2 day block (Salzburg + its car day-trips) can be composed into a
-- larger multi-city Austria trip, giving travellers a trusted starting point instead
-- of a blank build. Grounded in real Israeli travel sources (masa.co.il articles).
-- See docs/logic/trip-modules.md.
create table if not exists trip_templates (
  id uuid primary key default gen_random_uuid(),
  destination_id integer references destinations(id) on delete cascade,
  region text,                          -- e.g. "זלצבורג והסביבה"
  title_he text not null,
  audience text,                        -- 'families' | 'couples' | 'friends' | null (any)
  days integer not null,
  itinerary jsonb not null,             -- the full Itinerary (days/stops), car legs and all
  source_urls text[] not null default '{}',  -- the articles/sources that grounded it
  notes text,
  approved boolean not null default false,
  created_by text,                      -- editor email
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trip_templates_dest_idx on trip_templates (destination_id);
create index if not exists trip_templates_approved_idx on trip_templates (approved);
