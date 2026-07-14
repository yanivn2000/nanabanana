# Yalle — Backlog (discovered 2026-07-13/14)

Items found during the content-quality campaign (bulk re-ingest, signal quality,
dedupe, must-see images, taste-tagging) that are worth doing and not yet done.
Ordered within each section by rough priority. ✅ = done 2026-07-14.

## 🐞 Bugs & data errors
- ✅ **duration_minutes was 0%** → now 100% via fill_duration.py (category/subcategory
  heuristic). Feeds the itinerary builder + attraction "משך".
- ✅ **5 confirmed enrichment hallucinations hidden** (quality_keep=0, must_see=0):
  Ávila-in-Barcelona (6788), Acropolis-in-Larnaca (22047), Bergen-Belsen-in-Paris (26890),
  Portara-in-Thessaloniki (16712), Versailles-in-central-Paris (27184).
- **Broader hallucination audit** — an automated geo-scan (name→Wikipedia→coord distance)
  was too noisy: it can't separate a true hallucination from a real landmark whose English
  name differs from its local Wikipedia title (Roman Forum vs "Foro Romano", Venice St
  Mark's vs "Piazza San Marco", Berlin Naturkunde). Needs manual or AI review. Script:
  scratchpad/hallucination_scan.py.
- **Mislocated (coords wrong, name right)** — Plaça de Catalunya (7719, ~8 km off),
  Kallithea Springs (39317), St James Park (25372), Great Pagoda / Kew (25993). Map shows
  them in the wrong spot. Fix coords from the Wikipedia article point.
- **Commercial "experiences" flagged must_see** — Museum of Illusions (×2), Dialogue in the
  Dark, Amsterdam canal cruises, World of Banksy, Little Big City. Decide: un-mark or keep.
- **Possible remaining duplicates** — cross_dedupe only ran on shown, non-memorial rows.

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
