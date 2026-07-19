-- Phase 10 — the "how do I get from A to B" edge graph. The itinerary needs to
-- tell the traveller HOW to move between stops (walk / tram / metro), planned in
-- advance. Instead of recomputing every build (or hitting a paid routing API
-- whose terms forbid storing results), we cache each leg as a directed edge
-- between two attractions. The graph fills in from real trips and is reused
-- forever: once A→B is known, every future trip reads it instantly.
--
-- Walk is deterministic (haversine + a walking-speed estimate) and PERMANENT —
-- streets don't move. Transit is filled later from open GTFS/OTP and refreshed
-- occasionally (transit_checked_at + destinations.transit_synced_at), because
-- timetables change seasonally.
create table if not exists attraction_edges (
  destination_id     integer references destinations(id),
  from_id            integer not null references attractions(id) on delete cascade,
  to_id              integer not null references attractions(id) on delete cascade,
  walk_m             integer,          -- straight-line metres (haversine)
  walk_min           integer,          -- estimated minutes on foot
  transit_mode       text,             -- 'walk' | 'tram' | 'bus' | 'metro' | 'train' | null
  transit_line       text,             -- e.g. 'Tram 24'
  transit_min        integer,
  transit_transfers  integer,
  recommended        text,             -- 'walk' | 'transit' — the mode-agnostic default
  source             text default 'haversine', -- 'haversine' | 'osrm' | 'gtfs' | 'otp'
  computed_at        timestamptz default now(),
  transit_checked_at timestamptz,      -- when transit was last verified (null = never)
  primary key (from_id, to_id)
);
create index if not exists idx_edges_dest on attraction_edges(destination_id);

-- Per-city marker: when transit bridges for this city were last synced, so the
-- admin can see at a glance which cities are due a re-sync.
alter table destinations add column if not exists transit_synced_at timestamptz;
