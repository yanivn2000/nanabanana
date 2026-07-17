# Production Readiness — task list

Status: **not launch-ready** (2026-07-17). Core product is mature; the gaps are
around the newly-added public/community surface, abuse protection, and ops.

Legend — Severity: 🔴 blocker · 🟡 important · 🟢 nice-to-have.
Effort: S ≈ <½ day · M ≈ ½–1 day · L ≈ 2+ days.

---

## 🔴 Blockers — before posting any public link at scale

### P1. Rate-limit the public write endpoints · M — ✅ DONE (commit d384263)
- Postgres-backed fixed-window limiter (`rate_limits` table, `checkRateLimit`
  in `lib/db.ts`, fails open) + `lib/ratelimit.ts` (`clientIp`, `rateLimit`,
  `honeypotTripped`). Applied: share ≤5/min, comments ≤8/min, likes ≤30/min.
- Likes deduped SERVER-side by (slug, ip) via `trip_likes` table.
- Honeypot on the comment form; filled → silently dropped.
- Verified E2E. Remaining idea (future): also honeypot the publish flow if a
  bot-fillable form ever appears there.

### P2. Throttle + cap the AI cost surface · M — ✅ DONE (commit 14f7280)
- `/api/itinerary` (generate/revise): per-IP hourly limit + global daily
  circuit-breaker, env-tunable (`AI_PER_IP_HOURLY`=15, `AI_DAILY_CAP`=500).
  Over cap → 429; 70% → console.warn (real alerting = P6).
- `/api/admin/insights` distill: modest per-IP limit (editor-gated).
- Added `maxDuration=120` to the itinerary route (builds measured ~51s; Vercel
  would 504 otherwise).
- **Tune** `AI_DAILY_CAP` in Vercel env once real traffic volume is known.

### P3. Switch production DB to transaction mode · S — ✅ DONE (2026-07-17)
- Vercel `DATABASE_URL` switched `:5432` → `:6543` (transaction mode) + redeploy.
- Local `.env.local` also moved to 6543 (stops dev/scripts saturating the pool).
- Verified: 12 concurrent city-page requests all 200, no `EMAXCONNSESSION`, and
  ~2.5s vs ~4s before. NOTE: saw transient 500s on the home + city pages during
  the redeploy window itself (deploy propagation / cold-start) — self-resolved
  once instances warmed. A brief blip during any redeploy is expected.
- Code already hardened (`web/lib/db.ts`: max 4, idle/connection timeouts) and
  documented (`web/.env.example`).

### P4. Comment / trip moderation · M — ✅ DONE (commit a8136fc)
- Schema: `trip_comments.reported`, `shared_trips.hidden`+`reported`. Hidden
  trips filtered from every public read (getSharedTrip→404, gallery, count).
- Public 🚩 report (`/api/trips/report`, rate-limited) on each comment + a
  trip-level report at the page footer.
- Admin "🚩 מודרציה" tab: reported/hidden queue, one-click hide/unhide
  (`/api/admin/moderation`, editor-gated).
- Conservative spam pre-filter (`lib/content-filter.ts`): 2+ links / scam
  wordlist / char-runs → accept-and-drop.
- Verified E2E. **All 🔴 blockers now cleared.**

---

## 🟡 Important — for a real open launch

### P5. Terms of Service + Privacy Policy · M
B2C collecting emails (feedback) and hosting user-generated public content, with
EU destinations. Need `/legal/terms` + `/legal/privacy` pages and links in the
footer. Note: shared trips already sanitize kid names — document that.

### P6. Error tracking + alerting · S — ✅ DONE (commit 606ba62)
- `@sentry/nextjs` wired (server/edge/client configs + instrumentation.ts
  onRequestError + app/global-error.tsx). **Inert until `NEXT_PUBLIC_SENTRY_DSN`
  is set** — SDK disabled, zero network, app builds/runs the same.
- Explicit captures where errors were swallowed: rate-limiter fail-open catch +
  AI-budget 70% warning (captureMessage).
- ✅ **LIVE** — DSN set in Vercel, pipeline verified end-to-end (test message +
  exception delivered, flushed:true). Alert: "high priority issues" + email.

### P7. Cold-start the community galleries · M
Empty "טיולים של מטיילים" galleries read as a dead product. Per the strategy,
seed editor-curated "טיולי הבית" — 2–3 vetted trips for each top city (London,
Rome, Paris, Barcelona, Bucharest…). Use the existing build + publish flow;
mark them as house trips.

### P8. Curate the new-batch cities · M
Bucharest / Brasov / Krakow / Porto / Paphos / Crete ingested but not curated:
no must-sees, no Hebrew names/taglines/descriptions. Run the same curation pass
we did for Lefkada (editor must-sees + Hebrew). Rome/Athens food coverage thin —
consider a wider ingest gate there.

### P9. robots.txt + sitemap · S
For the link-sharing/SEO strategy: add `web/app/robots.ts` and a `sitemap.ts`
that includes destinations and public shared trips. Confirm OG/twitter tags are
right (they are for `/t/[slug]`).

---

## 🟢 Nice-to-have

- **P10. Optional accounts** · L — everything is localStorage today (no
  cross-device, no recovery). Supabase auth is already wired in middleware;
  offer optional login to claim/sync trips. Product call, not a blocker.
- **P11. Analytics** · S — a privacy-friendly analytics (Plausible/Umami) to see
  which shared links convert. Feeds the marketing loop.
- **P12. Perf pass** · S — city page loads up to 2000 attraction rows
  (`attractionsForMap(dest.id, 2000)`); fine now, revisit if cities grow.
- **P13. Accessibility sweep** · S — focus states, aria labels, RTL edge cases
  on the new community components.

---

## Suggested order
P3 (5 min, do first) → P1 → P2 → P4 → P6 → P5 → P7/P8 (content, parallel) → P9.
Roughly a focused week to clear all 🔴 + the critical 🟡 (P4–P6).
