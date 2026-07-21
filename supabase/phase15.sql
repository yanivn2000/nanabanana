-- Human-friendly reference number per module ("משבצת #<ref>") — a stable, shareable
-- id the team can quote ("module #14") instead of the opaque uuid.
create sequence if not exists trip_templates_ref_seq;
alter table trip_templates add column if not exists ref integer;
alter table trip_templates alter column ref set default nextval('trip_templates_ref_seq');
update trip_templates set ref = nextval('trip_templates_ref_seq') where ref is null;
alter table trip_templates alter column ref set not null;
create unique index if not exists trip_templates_ref_uidx on trip_templates (ref);

-- Editor "notes to the Brain": build-POLICY guidance (not per-attraction facts) that
-- the editor writes from a trip page, queued for digestion into lib/brain/policy.ts —
-- e.g. "no museum right after a museum", "A→B is too far", "evenings in area X/Y".
-- (Per-attraction facts go to the `insights` consensus layer instead.)
create table if not exists brain_notes (
  id serial primary key,
  destination_id integer references destinations(id),
  trip_ref text,                          -- which trip/module it came from (free ref)
  scope text not null default 'city',     -- 'trip' | 'city' | 'global'
  note text not null,
  status text not null default 'queued',  -- 'queued' | 'digested'
  created_by text,
  created_at timestamptz not null default now(),
  digested_at timestamptz
);
create index if not exists brain_notes_status_idx on brain_notes (status);
