# Yalle — Backlog (discovered 2026-07-13/14)

Items found during the content-quality campaign (bulk re-ingest, signal quality,
dedupe, must-see images, taste-tagging) that are worth doing and not yet done.
Ordered within each section by rough priority.

## 🐞 Bugs & data errors
- **Mislocated attractions** — coordinates far from the real place, so the map is wrong:
  Versailles (id 27184, ~12 km into central Paris), Plaça de Catalunya (7719, ~8 km),
  Kallithea Springs (39317, ~8 km), St James Park (25372), Great Pagoda / Kew (25993).
- **Attractions in the wrong city** — Ávila walls (6788) tagged in Barcelona; "Acropolis"
  (22047) in Larnaca; Bergen-Belsen (26890) in Paris; Portara/Naxos (16712) in Thessaloniki.
- **Commercial "experiences" wrongly flagged must_see** — Museum of Illusions (×2),
  Dialogue in the Dark, Amsterdam canal cruises, World of Banksy, Little Big City,
  high-ropes course. Decide: un-mark must_see or keep.
- **Possible remaining duplicates** — cross_dedupe only ran on shown, non-memorial rows;
  other categories may still hold same-place/different-wikidata dupes.

## 🖼️ Images (must-see at 88%; 78 remain)
- **~30 famous must-see with no API-resolvable image** — Petaloudes, Anthony Quinn Beach,
  Tsampika, Sisi Museum, Street of the Knights, Kition, Kotsanas Museum. Photos exist on
  Wikimedia Commons but need hand-picking.
- **26 viewpoints/panoramas** without image — skipped (auto-match grabs a wrong neighbour).
- **Low image coverage for non-must-see** (7–42%) — run pipeline_images more broadly.

## 📊 Content gaps (from the audit)
- **description_he = 0% system-wide** — the expanded card has no real long description.
- **duration_minutes = 0% system-wide** — directly hurts AI itinerary quality.
- **Thin cities need Hebrew enrichment** — Batumi (38 shown), Larnaca (53), Zurich (6
  must-see), Madrid (16), Milan (20).
- **Traveler insights only in Salzburg + Amsterdam** — 23 cities without.
- **Memorial noise still in DB** — Tbilisi 862, Budapest 1915 (hidden by the prominence
  pass, but present).
- **`food` taste tag sparse outside London** — OSM tourism has no restaurants, only food
  markets. Food personalization needs a restaurant data source (e.g. Google Places).

## 🔧 Tooling to productionize (currently scratchpad)
- **cross_dedupe** — catch same-place/different-wikidata dupes (Big Ben case). Move into
  the repo; re-run after every re-ingest.
- **Image resolver** (pageimages + Wikidata P18 + name+coord verify) — fold into
  pipeline_images.py (which today only uses the REST summary + stored info_sources).
- **prominence_pass** — the signal-quality heuristic; make it a re-runnable repo tool.
- **Multi-center re-ingest** — big cities/islands (Rhodes) need several Overpass centers;
  currently done by hand.

## 🔐 Auth (some steps are the owner's to do)
- **Supabase email template** — add `{{ .Token }}` so the 6-digit code works (app code is
  ready, waiting on the template edit). Requires custom SMTP to unlock template editing.
- **Custom SMTP** (Brevo/Resend) — fixes the 2-emails/hour rate limit.
- **Google OAuth login** — designed, not built; waiting on an OAuth client. Best UX win
  (no email, no rate limit).

## ✨ Product opportunities
- **Restaurant data source** (Google Places) — unlocks real culinary personalization.
- **AI quality pass** (enrich.py) over ~17,700 quality_keep=NULL rows — sharper filtering,
  but costs API credit.
- **8 cities without a poster** — thessaloniki, larnaca, batumi, venice, florence, zurich,
  nice, rhodes (owner-generated art).
- **Sharper taste tags outside London** — currently mostly structural; enrich per-city
  keywords or use AI tagging.
