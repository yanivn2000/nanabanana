-- The Brain's "how to cook" — general TECHNIQUES, transparent + editable by the
-- editor, executable by the Brain. Each principle is a TYPED rule: a `kind` from a
-- fixed vocabulary (lib/brain/rules.ts) + `params` (jsonb). The editor edits params
-- via dropdowns and reads an auto-rendered Hebrew sentence; the Brain reads the
-- typed kind+params and never parses free text. See docs/logic/brain.md.
--
-- Scope: 'global' techniques apply to every trip; 'city' techniques only to their
-- destination (the dish-specific seasoning). Digested editor notes land here as
-- rows, linked back to their source note.
create table if not exists brain_principles (
  id serial primary key,
  kind text not null,                       -- rule kind (fixed vocabulary)
  params jsonb not null default '{}',       -- rule parameters
  scope text not null default 'global',     -- 'global' | 'city'
  destination_id integer references destinations(id) on delete cascade,  -- for scope='city'
  audience text,                            -- optional narrowing: families|couples|friends
  enabled boolean not null default true,
  source_note_id integer references brain_notes(id) on delete set null,  -- which editor note produced it
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brain_principles_scope_idx on brain_principles (scope, destination_id);
