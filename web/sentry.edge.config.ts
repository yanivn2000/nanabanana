import * as Sentry from "@sentry/nextjs";

// Edge-runtime (middleware) error tracking. Inert until NEXT_PUBLIC_SENTRY_DSN.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
