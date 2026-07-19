-- Phase 12 — neighbourhoods as first-class experiences. An area can be more than
-- an organising layer: a "vibe" area (Shoreditch, Camden, De Pijp) IS the
-- experience, and a landmark-dense area (Westminster) is a "don't miss this part
-- of the city". Both can be a headline card on the city page, framed differently.
--
--   kind:     'landmark' (you go for the POIs inside) | 'vibe' (the area itself is
--             the draw — market, streets, cafés).
--   headline: show it as a first-class "must experience" card above the attractions.
alter table areas add column if not exists kind text default 'landmark';
alter table areas add column if not exists headline boolean default false;
