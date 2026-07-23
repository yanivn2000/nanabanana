-- Phase 18 — per-user, cross-device trips (server-synced, with anonymous carry-over)
--
-- Until now a traveller's trips lived only in each browser's localStorage
-- (web/lib/store.ts, key "nanabanana.trips.v1"), so the SAME logged-in account
-- saw different trips on desktop vs phone. This makes trips first-class rows in
-- Postgres, owned by an auth user (anonymous OR permanent), guarded by RLS.
--
-- Model: the WHOLE Trip object is stored as jsonb `data` (the Trip type is rich
-- and evolving — packing/checklist/budget/selection/leftOut/itinerary…), keyed by
-- (user_id, client_id) where client_id is the app's existing opaque trip id. The
-- app reads/writes its own rows through the Supabase browser client, so RLS
-- (auth.uid() = user_id) is the only gate — no service-role needed for CRUD.
--
-- Idempotent: works whether or not the legacy `trips` table (schema.sql) exists.
-- Apply in the Supabase SQL editor. Prerequisite: enable "Anonymous sign-ins" in
-- Auth → Providers (dashboard) so first-time visitors get a session automatically.

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Bring a pre-existing (legacy) trips table up to the shape we need.
alter table trips add column if not exists client_id text;
alter table trips add column if not exists data jsonb;
alter table trips add column if not exists updated_at timestamptz default now();
alter table trips alter column user_id set default auth.uid();

-- One row per (user, client trip id) → upsert target for sync.
create unique index if not exists trips_user_client on trips (user_id, client_id);
create index if not exists idx_trips_user on trips (user_id);

-- Owner-only access (anon or permanent user; same policy).
alter table trips enable row level security;
drop policy if exists trips_owner on trips;
create policy trips_owner on trips
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
