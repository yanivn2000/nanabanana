-- Phase 6 — verified-knowledge layer ("training" on team-approved traveller
-- content). Real posts are pasted in the admin, distilled ONCE by Claude into
-- structured per-place insights, approved by the team, and then used by the
-- consumer app BOTH with AI (injected into the itinerary prompt with top
-- priority) AND without AI (shown on attraction cards).

-- Raw source posts (one row per pasted post).
create table if not exists sources (
  id serial primary key,
  destination_id integer references destinations(id),
  url text,
  author text,
  raw_text text,
  created_at timestamptz default now()
);

-- Distilled + approved insights. Each links to a source and (where matched) to
-- one of our attractions; unmatched insights keep the free-text place_name.
create table if not exists insights (
  id serial primary key,
  source_id integer references sources(id) on delete cascade,
  destination_id integer references destinations(id),
  attraction_id integer references attractions(id),
  place_name text,
  kind text,            -- tip | warning | verdict | food | season | access
  text_he text,
  sentiment text,       -- pos | neg | neutral
  status text default 'approved',
  weight integer default 1,
  created_at timestamptz default now()
);
create index if not exists idx_insights_dest on insights(destination_id);
create index if not exists idx_insights_attr on insights(attraction_id);

-- Insights are read by the consumer app (anon). Sources stay admin-only.
alter table insights enable row level security;
drop policy if exists insights_read on insights;
create policy insights_read on insights for select using (true);
