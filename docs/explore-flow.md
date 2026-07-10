# חקירת יעד — Explore Flow (build spec, slice 1)

**Status:** design approved 2026-07-09 ("מאוד אהבתי את הכיוון"). Building **slice 1**, piloted on **London**.
**Shape:** a NEW parallel menu ("חקירת יעד"), alongside the existing app — does not replace anything.
**Owner context:** B2C trip planner "Yalle" (formerly NanaBanana). RTL Hebrew. Next.js 16 (App Router,
Turbopack dev), React, Tailwind v4, TS, deployed on Vercel (auto-deploy on push to `main`;
prod = nanabanana-nine.vercel.app). Supabase Postgres shared DB.

> Local dev server is unreliable (recurring `.next/dev` turbopack corruption). **Verify on prod** after push.

---

## The product POV

When the user already knows they want to *explore a specific destination*, walk them through 4 stages
that get progressively more specific — macro → categories → attractions → a built trip — with the AI
active early and a learning-recommender that gets smarter as trips accumulate.

### The 4 steps
1. **פרופיל** — who's travelling (reuse the existing profile; calibration is **per-THIS-trip**).
2. **מאקרו** — the destination two ways:
   - (a) the place at macro level: **weather widget + narrative paragraph + short history + language**;
   - (b) the place **through the profile lens** — attraction *categories/types* (NOT specific attractions
     yet), honest fit, **like/dislike** to sharpen. **5–15 category cards.**
3. **אטרקציות** — a SHORT, taste-ranked list derived from steps 1+2: image-forward, brief read,
     external link, price, **tag/icon markers**, and a 3-way **כן / אולי / לא** per item. **~50 total** across
     all types.
4. **בנייה** — build the trip: days, daily travel radius, and the day opens with an **anchor**
     (selected/must-see) then fills with "**אם יש זמן**" (non-selected) items.

### Locked decisions (from the user, verbatim intent)
1. **Data readiness** → pilot on London first.
2. **Macro accuracy** → start with **AI-generated** macro, migrate to **reliable-source APIs** later
   (weather / facts).
3. **Must-see baseline + gentle nudge** → include iconic must-sees even when the profile is ambiguous.
   Example: user is *undecided* about shows → still suggest a **West End musical** in London. This is a
   discovery/serendipity dial, kept gentle. Mark such items with a "דחיפה" tag.
4. **Positive-only framing** → always "**הנה מה שכן בשבילכם**"; **never** write "this isn't for you."
   Fit is shown as *how vibrant* a category is, never as a negative.
5. **Per-trip calibration** → the Explore session's likes/dislikes + selection attach to **the trip**
   (like the existing per-trip `trip.profile`), NOT the global profile — a couples' trip differs entirely
   from a trip with the kids.
- **Build order** → selected/must first (day anchors), then non-selected as "would be nice to fit."
- **Learning recommender** → YES; capture every like/dislike/selection as a labeled example keyed by the
  taste vector, from day one. The Explore funnel is a data-generation machine.
- **List lengths** → step 2: **5–15** category cards; step 3: **~50** attractions total.

### Two implications surfaced (and accepted)
- The day becomes **two-tier**: anchors + "אם יש זמן" fillers — affects the trip data model + display.
- Calibration/selection live on the **trip**, reusing the existing per-trip profile override.

---

## What already exists (reuse — do NOT rebuild)

### Data (`web/lib/db.ts`)
```
getDestination(id: number): Destination | null
listDestinations(): Destination[]
topAttractions(destinationId, limit=40): Attraction[]          // quality/family-ordered
attractionsForMap(destinationId, limit=200): Attraction[]
destinationSummaries(): DestinationSummary[]                    // per-category counts per city
insightsForDestination(destinationId): Insight[]               // verified-knowledge layer (approved)

type Attraction = { id, name_he, name_en, lat, lng, category, subcategory, indoor_outdoor,
  family_score, tips_he, website, duration_minutes, image_url, tagline_he, best_season,
  best_time_he, dress_he, cost_level, must_see, description_he, taste_tags: string[]|null }
type Destination = { id, city, country, city_he, country_he, lat, lng, attraction_count }
type DestinationSummary = { id, city, country, city_he, country_he, total, nature, museum,
  historic, food, shopping, water_park, theme_park, zoo, must_see }
```
London (destination_id 14) is **taste-tagged** (791 attractions). Other cities are not yet tagged —
`rankByTaste` falls back to family order when there's no taste signal, so the flow degrades gracefully.

### Taste engine (`web/lib/taste.ts`)
```
INTEREST_TASTE: Record<interestChip, tasteTag[]>              // profile chip → taste vocab
deriveTaste(p: FamilyProfile): Record<tag, number>           // likes +3, dislikes -3, baseline +1
rankByTaste(attractions, taste, n): Attraction[]             // taste*3 + family_score + must_see*2, top n
tasteScore(tags, weights): number
tasteEmphasis(taste): string                                 // top tags (w>=4) → Hebrew line for the AI
// TAG_HE (internal): live_music, nightlife, vintage_shopping, luxury_shopping, theatre,
//   classical_opera, sports, food, art, history, nature, family, culture
```
Taste tag vocabulary (from `taste_tag.py` / eval): structural = nature/art/history/landmark;
taste = vintage_shopping/luxury_shopping/live_music/classical_opera/theatre/nightlife/sports/food/family.

### Store (`web/lib/store.ts`)
```
FamilyProfile.taste?: Record<string, number>                 // explicit taste weights (equalizer)
Trip.selection?: { yes: number[]; maybe: number[]; no: number[] }   // <-- ADDED (uncommitted) for Explore
Trip.profile?: FamilyProfile                                 // per-trip override
useProfile(), useTrips().create(t), datesToInfo(), monthSeason(month)
```

### Generator (`web/app/api/itinerary/route.ts`, `web/lib/ai.ts`)
- POST body: `{ mode:"generate"|"revise"|"details", city, days, month, profileText, taste, segments,
  hotels, current, instruction, dateContext }`.
- Pipeline: `pool = topAttractions(dest.id,150); attractions = rankByTaste(pool, body.taste, 50)` →
  fed to `generateItinerary({..., attractions, emphasis: tasteEmphasis(body.taste)})`.
- **Caveat:** the route fetches its OWN attractions server-side. It does NOT accept a client-provided
  attraction list. So "build strictly from the selection (anchors)" needs a small route change — see
  fast-follow F1.

### Existing routes
- `app/explore/page.tsx` + `ExploreList.tsx` — the **destinations grid** ("גלו יעדים").
- `app/destination/[id]/page.tsx` + `DestinationView.tsx` — destination detail (attractions map,
  insights, passes).
- `app/trip/[id]/TripView.tsx` — the trip page (sends `taste: deriveTaste(tripProfile)` to the API; #63).
- `app/profile/page.tsx` — profile + Follows editor (#65).

---

## Slice 1 — build plan

Goal: a **real, clickable Explore flow on London**, end-to-end, using real data, producing a Trip
pre-loaded with the calibrated taste + selection, that hands off to the existing generator.

### New files
1. **`web/lib/explore.ts`** (pure logic, no JSX):
   - `CITY_BRIEF: Record<string, { narrative_he: string; history_he: string; language_he: string }>`
     — hand-written for London now (+ a generic fallback). (AI-generated briefs = fast-follow F2.)
   - `seasonalWeather(month): { he: string; hint_he: string }` — seasonal averages text by month
     (Europe/N-hemisphere). (Live weather API = fast-follow F2.)
   - `EXPLORE_CATS: { tag: string; label_he: string; icon: string }[]` — the category vocabulary,
     ordered by general appeal (live_music, vintage_shopping, nightlife, theatre, art, history,
     nature, food, luxury_shopping, sports, family, landmark…). `icon` = lucide component name.
   - `categoriesFor(attractions, taste, max=12): { tag, label_he, icon, count, vibe_he, hot }[]`
     — for each cat tag, count attractions whose `taste_tags` include it; keep count>0; sort by
     profile relevance (taste weight) desc, then count; cap 5–15. `vibe_he` from count
     (e.g. >30 "שוקק" / 10–30 "מלא" / 3–10 "יש כמה" / 1–3 "מעט"). `hot` = must-see/landmark flag for
     the "בולט" badge. **Positive framing only.**
   - `calibrate(base, likes:Set<string>, dislikes:Set<string>): Record<tag,number>` — like → +2,
     dislike → -3 on top of `deriveTaste(profile)`.
   - `attractionTags(a): { label_he, kind }[]` — map `a.taste_tags` + cost_level (free/££/£££) +
     must_see → display chips/icons for step 3.
2. **`web/app/explore/[id]/page.tsx`** (server): `getDestination(id)` + `topAttractions(id, 200)`
   (has `taste_tags`) + `insightsForDestination(id)` + the matching `destinationSummaries()` row →
   render `<ExploreFlow …/>`. (Nests cleanly under the existing `/explore` list.)
3. **`web/app/explore/[id]/ExploreFlow.tsx`** (client): the 4-step stepper.
   - `useProfile()` for step 1 (compact summary + "לטיול הזה" note).
   - Step 2: `seasonalWeather(month)` + `CITY_BRIEF[dest.city]` + `categoriesFor(attractions,
     deriveTaste(profile))` cards with like/dislike → updates `calib`.
   - Step 3: `rankByTaste(attractions, calibrate(base, likes, dislikes), 50)` → image-forward cards
     with `attractionTags`, description_he/tagline_he, website link, price, must "בולט"/"דחיפה"
     badges, and כן/אולי/לא. Track `selection`.
   - Step 4: days + radius sliders. Build → `useTrips().create({ title:`${cityHe} — חקירה`,
     mode:"preferences", city, cityHe, country, destinationId, days, month,
     profile:{...profile, taste: calibratedTaste}, selection:{yes,maybe,no} })` →
     `router.push('/trip/'+id)`. The trip page then generates using `trip.profile.taste` (#63).

### Edits
- **`web/lib/store.ts`** — `Trip.selection?` already added (uncommitted). ✔
- Entry point — add a "**חקור את היעד**" button on `DestinationView.tsx` header (and/or the
  `ExploreList` cards) → `/explore/[id]`.

### Slice-1 boundary
Slice 1 saves the calibrated taste + selection and hands off to the existing generator (selection is
persisted; taste flows via `trip.profile.taste`). It does NOT yet build strictly from the selection.

---

## Step 2 refinements (shipped after slice 1)
Two changes to the category cards, so step 2 reads as *calibrating a loaded profile*, not filling one:
- **Composition filter** — `categoriesFor(attractions, taste, profile, max)` now drops categories the
  traveler composition makes irrelevant. Rules live in `CAT_RELEVANCE` (`explore.ts`), keyed by
  tag → predicate over the profile (today: `family` needs `kids.length > 0`). Derived from live step-1
  state, never a static exclude list — editing "who's travelling" re-filters step 2 on re-entry.
- **Calibration framing** — step 2 seeds `likes`/`dislikes` from the profile once it hydrates
  (interest tags ≥3 → pre-liked, dislikes <0 → pre-disliked), shows a banner ("ההעדפות שלכם כבר טעונות
  מהפרופיל — כאן רק מכווננים…, לא משנה את הפרופיל הכללי"), and splits cards into a prominent
  *"מה מיוחד ב<city>"* list (non-profile categories) + a collapsed *"N העדפות מהפרופיל שלכם"* section
  (the seeded ones, pre-marked). Calibration stays per-trip: it only writes `trip.profile.taste` on
  build and never calls the global-profile setter.

## Step 3 refinements (shipped after slice 1)
Progressive disclosure so a card carries enough to decide כן/אולי/לא without bloating the ~50-item
triage. Compact card is unchanged; a chevron expands an accordion (one open at a time, `openCard`
state). Expansion (all from existing DB fields + insights → **no API cost**):
- **"למה מתאים לכם"** (`whyItFits`) — the ≤2 taste tags this attraction matches in the *calibrated*
  trip taste (`landmark` excluded — it's a must-see marker, not a taste); falls back to a must-see line
  so iconic spots still get a reason.
- **Full `description_he`** (unclamped; skipped if it only repeats the one-line tagline).
- **Practical facts** (`attractionFacts`) — duration (`durationHe`), best time, indoor/outdoor
  (`indoorHe`, maps `both`/`mixed`), dress. Cost stays a compact chip.
- **Verified-traveller insights** — up to 2 from `insightsForDestination` (now loaded in `page.tsx` and
  passed as `insights` to `ExploreFlow`), grouped by `attraction_id`, labelled via `INSIGHT_KIND_HE`.
  London (dest 14) has **zero** attraction-linked approved insights today, so this block only shows once
  the admin adds them (verified on dest 8 / Amsterdam, which has 109).

## Fast-follows (after slice 1)
- **F1 — anchors build** ✅ SHIPPED (commit 329ecbd): the itinerary POST accepts
  `selection:{yes,maybe,no}`; `partitionBySelection` splits the pool into anchors (yes picks, else
  must-see fallback, minus "לא") + "אם יש זמן" fillers; `Stop.anchor` drives the two-tier display.
- **F2 — real macro**: AI-generated `destination brief` (narrative/history), then a reliable weather
  API for live/averages. (Decision 2.)
- **F3 — learning recommender**: persist every like/dislike/selection keyed by taste vector; retrieve
  & adapt accepted trips for similar profiles. (Decision: yes.)
- **F4 — taste-tag more cities** (only London is tagged today) — ticket #71.
- Related open epic #60 children: #66 onboarding, #67 events feed in itinerary, #68 event connectors
  (needs keys), #69 curated happenings, #70 AI-distilled exhibitions, #72 data-gap ingestion.

## Verification checklist (prod)
- `/explore/14` loads (London), 4 steps navigate.
- Step 2: 5–15 category cards, real counts, like/dislike sharpens step 3.
- Step 3: ~50 taste-ranked attractions, tags/price/must badges, כן/אולי/לא persists.
- Step 4: build creates a Trip with `profile.taste` + `selection`, lands on `/trip/[id]` and generates.
- Music/vintage vs sports/history calibration → visibly different step-3 lists (the #63 proof, now
  user-driven).

## Constraints (persist)
- User creates ALL external accounts/API keys; wire code + reference env var NAMES only; never paste
  secrets into chat/git. GitHub push protection ON.
- Deploy consumer via **Vercel** (push to `main`). Do NOT run the VM `nanabanana.sh` full web-rebuild.
- Descriptions / taste-tags generated **in-session** (no API cost) per user preference.
