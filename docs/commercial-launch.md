# Yalle — Commercial Launch Checklist (yalle.co)

Status: **prep started 2026-08-01** (domain yalle.co purchased). Product + core
safety are mature (all 🔴 production-readiness blockers cleared; Sentry live;
rate limits + AI cost caps + moderation shipped; accounts shipped). What remains
is the "turn it into a business" layer: domain, a safety net for releases, legal,
optional payments, analytics, content seeding, and trust polish.

Legend — 🔴 must-have before charging / public push · 🟡 important · 🟢 polish.

---

## 0 · Decisions needed first (they change the rest of the list)
- **Business model at launch** — free · freemium (paid AI / pro features) · other.
  Determines whether §4 (payments) is in scope for v1. Today: builds are FREE
  (heuristic engine); paid Anthropic AI is an opt-in hook (`body.ai`) not yet gated.
- **Launch scope** — soft (Hebrew FB groups, same as today) vs. open/SEO push.
  Affects how hard we need §3 (legal) and §5 (analytics) on day one.

## 1 · Domain & infra — yalle.co  🔴
- [ ] Add `yalle.co` to the Vercel project; point DNS (A/ALIAS + CNAME for www); set as **primary** domain.
- [ ] `www.yalle.co` → `yalle.co` redirect (Vercel does this once both are added).
- [ ] Set **`NEXT_PUBLIC_SITE_URL=https://yalle.co`** in Vercel prod env → flows into
      `SITE_URL` (lib/site.ts), `metadataBase`, OG/canonical, `robots.ts`, `sitemap.ts`.
- [ ] SSL — automatic via Vercel once DNS resolves; verify.
- [ ] Email on the domain: at least `hello@yalle.co` / `support@yalle.co` (forwarder is fine)
      for the footer + as the geocode/User-Agent contact (currently `yaniv@eos-online.com`).
- [ ] Google Search Console: verify `yalle.co`, submit `/sitemap.xml`.
- [ ] Team login (admin + editor) stays on `@eos-online.com` (lib/admin.ts) — fine to keep;
      decide later if you want `@yalle.co` team accounts.

## 2 · Staging / release safety — currently NONE  🔴 (highest ops risk)
- Today `main` → Vercel **production**, and every write hits the **prod DB**. No net.
- [ ] Stand up a **staging** environment: a `staging` branch + Vercel env pointing at a
      **separate (non-prod) database**, so we can test builds/migrations before prod.
- [ ] Protect `main` (require the preview/build to pass before it becomes prod).
- [ ] Confirm the Postgres provider has **automated backups**, and do one **test restore**.

## 3 · Legal / compliance — required for B2C + EU + emails + UGC + accounts  🔴
- [ ] `/legal/terms` + `/legal/privacy` pages, linked in the footer (P5 — still open).
- [ ] Cookie/consent: Supabase auth cookies (+ analytics if added) → GDPR banner or a
      documented "essential-only" stance.
- [ ] **Right to erasure + data export**: "delete my account" and "download my data"
      (accounts + trips) — not built today.
- [ ] Public **content policy** for shared trips (moderation exists; publish the rules).
- [ ] Contact / company identity on the site.

## 4 · Monetization — only if charging at launch  🟡/🔴 (depends on §0)
- [ ] Payments provider — **none integrated** (Stripe / Paddle / LemonSqueezy).
      Paddle/LS act as Merchant-of-Record → they handle EU VAT + invoices (simplest for a
      solo EU seller); Stripe needs Stripe Tax + your own invoicing.
- [ ] Pricing page + plan gating; wire the existing `body.ai` opt-in as the paid AI upgrade,
      or gate pro features.
- [ ] Free-tier limits / trial rules.

## 5 · Analytics & growth  🟡
- [ ] Privacy-friendly analytics — Plausible / Umami (P11); **none installed today**.
- [ ] Share-link → build conversion funnel (the core growth loop).
- [ ] Verify OG images render on yalle.co (satori Hebrew RTL needs the manual transform).

## 6 · Content readiness  🟡
- [ ] Seed the community galleries with editor "house trips" per top city (P7) — empty
      galleries read as a dead product.
- [ ] Curate the new-batch cities (P8): must-sees + Hebrew names/taglines/descriptions.
- [ ] Continue the content-gap campaign (next: Tbilisi → Budapest → Berlin).
- [ ] Ensure every **launch** city has must-sees + Hebrew + images before it's promoted.

## 7 · Trust & polish  🟡/🟢
- [ ] Branded **404** (`app/not-found.tsx`) + route **error** boundary (`app/error.tsx`).
      `app/global-error.tsx` already exists (Sentry).
- [ ] `app/apple-icon.png` (iOS "add to home screen") — missing; favicon.ico + icon.svg done.
- [ ] First-run onboarding / friendly empty states.
- [ ] Per-page SEO meta (city/trip descriptions) + JSON-LD structured data.
- [ ] Loading skeletons on the slower pages.

## 8 · Ops & safety — mostly done  🟢
- [x] Sentry live (P6); [ ] tune `AI_DAILY_CAP` to real volume, set alert thresholds.
- [ ] Uptime monitor (simple cron ping).
- [x] Rate limits (P1) + AI cost caps (P2) + moderation (P4) + robots/sitemap (P9).
- [ ] Short incident / rollback runbook.

---

## Suggested order
Decisions (§0) → Domain (§1) + Staging (§2) → Legal (§3) → Content (§6) + Analytics (§5)
→ Monetization (§4, if paid) → Polish (§7). Domain + staging + legal are the true gates;
everything else can land incrementally after the site is safely on yalle.co.
