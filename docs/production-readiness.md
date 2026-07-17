# Production Readiness — task list

Status: **not launch-ready** (2026-07-17). Core product is mature; the gaps are
around the newly-added public/community surface, abuse protection, and ops.

Legend — Severity: 🔴 blocker · 🟡 important · 🟢 nice-to-have.
Effort: S ≈ <½ day · M ≈ ½–1 day · L ≈ 2+ days.

---

## 🔴 Blockers — before posting any public link at scale

### P1. Rate-limit the public write endpoints · M
All anonymous, no throttle today: `/api/trips/share`, `/api/trips/comments`,
`/api/trips/like` (`web/app/api/trips/*`). A bot can flood junk trips/comments
under the Yalle brand.
- Add IP-based rate limiting in `web/middleware.ts` (it already runs on every
  request). Options: Upstash Redis (`@upstash/ratelimit`, serverless-friendly)
  or a lightweight in-memory limiter as a stopgap.
- Suggested limits: share ≤ 5/min/IP, comments ≤ 8/min/IP, like ≤ 30/min/IP.
- Add a hidden honeypot field to the comment + publish payloads; reject if filled.
- Server-side dedup for likes (right now dedup is client-only localStorage —
  trivially bypassed). At minimum cap total likes per IP per trip.

### P2. Throttle + cap the AI cost surface · M
`/api/itinerary` (and insights distill in `/api/admin/insights`) call Claude with
no throttle. Public + unthrottled = someone can burn the Anthropic budget in a
loop.
- Per-IP rate limit on `/api/itinerary` (e.g. ≤ 10 builds/hour/IP).
- A global daily spend circuit-breaker (count calls in a table / Redis; refuse
  past a ceiling) so a runaway can't exceed a known daily cost.
- Alert when the daily counter crosses ~70%.

### P3. Switch production DB to transaction mode · S
`DATABASE_URL` in Vercel still points at port `:5432` (session mode, 15-client
cap). Under real concurrency it throws `EMAXCONNSESSION`.
- Vercel → Settings → Environment Variables → change `:5432/` → `:6543/`.
- Redeploy, then load-check the city + gallery pages.
- Code already hardened (`web/lib/db.ts`: max 4, idle/connection timeouts) and
  documented (`web/.env.example`).

### P4. Comment / trip moderation · M
Public user content under the brand, but no way to report or take down.
- "🚩 דיווח" button on each comment + on shared trips → sets a `reported` flag
  (add column) / notifies admin.
- Admin moderation view: list reported items, one-click hide (the
  `trip_comments.hidden` column already exists; `shared_trips` needs a `hidden`
  flag + filtering in `getSharedTrip`/gallery queries).
- Basic word-block list on comment submit as a first filter.

---

## 🟡 Important — for a real open launch

### P5. Terms of Service + Privacy Policy · M
B2C collecting emails (feedback) and hosting user-generated public content, with
EU destinations. Need `/legal/terms` + `/legal/privacy` pages and links in the
footer. Note: shared trips already sanitize kid names — document that.

### P6. Error tracking + alerting · S
No observability today — a prod failure is invisible. This is what would have
auto-caught the pooler saturation.
- Add Sentry (`@sentry/nextjs`) for client + server errors.
- Alert on: DB connection errors, AI 4xx/5xx, elevated 500 rate.

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
