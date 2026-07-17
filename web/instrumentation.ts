import * as Sentry from "@sentry/nextjs";

// Loads the right Sentry config per runtime, and forwards nested React Server
// Component / route-handler errors to Sentry via the onRequestError hook.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
