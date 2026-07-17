import * as Sentry from "@sentry/nextjs";

// Server-runtime error tracking. Inert until NEXT_PUBLIC_SENTRY_DSN is set in
// the environment (no DSN → the SDK initializes but sends nothing), so the app
// builds and runs identically with Sentry "off".
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,          // 10% perf traces; errors are always captured
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
