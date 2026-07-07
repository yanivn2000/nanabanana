-- Phase 9 — happenings: the unified "what's on" model (extensibility keystone).
-- One normalized table for EVERY kind of happening from EVERY source, with a
-- `temporal` shape so a one-night gig (point), a months-long musical (run), a
-- weekly market (recurring), an annual holiday (annual) and the Christmas season
-- (seasonal) all live together. Any connector (Ticketmaster / Bandsintown /
-- curated observances / AI-distilled exhibitions) just inserts rows; the
-- time-aware matcher never changes. taste_tags reuses the attraction taste
-- vocabulary, so the same taste model scores attractions AND happenings.
create table if not exists happenings (
  id serial primary key,
  destination_id integer references destinations(id),
  title_he text, kind text, taste_tags jsonb,
  temporal text,                 -- point | run | recurring | annual | seasonal
  start_date date, end_date date,
  recur text,                    -- 'weekly:0,5,6' | 'MM-DD' | 'MM-DD..MM-DD'
  venue text, lat double precision, lng double precision,
  price_from numeric, currency text default 'GBP',
  url text, image_url text, performers jsonb,   -- artists/teams for follow-matching
  source text, source_id text, fetched_at timestamptz default now(),
  unique(source, source_id)
);
create index if not exists idx_happ_dest on happenings(destination_id);
