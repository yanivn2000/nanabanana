-- Phase 8 — taste layer for ultra-personalization (Phase 0 of the taste engine).
-- Each attraction carries taste_tags (jsonb array): structural tags (nature/art/
-- history/landmark) + taste tags (vintage_shopping/luxury_shopping/live_music/
-- classical_opera/theatre/nightlife/sports/food/family). A traveller's weighted
-- taste model scores attractions against these tags, so two couples in the same
-- city get divergent picks. Curated per city (London pilot: 791 attractions).
alter table attractions add column if not exists taste_tags jsonb;
create index if not exists idx_attr_taste on attractions using gin (taste_tags);
