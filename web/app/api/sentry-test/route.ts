import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

// TEMPORARY — verifies the Sentry pipeline end to end. Captures a test message +
// exception, flushes, and reports whether events actually left the server.
// Remove after confirming they land in the Sentry dashboard.
export async function GET() {
  const dsnSet = !!process.env.NEXT_PUBLIC_SENTRY_DSN;
  const msgId = Sentry.captureMessage("Yalle Sentry pipeline test (message)", "info");
  const errId = Sentry.captureException(new Error("Yalle Sentry pipeline test (exception)"));
  const flushed = await Sentry.flush(4000); // true = events were delivered
  return NextResponse.json({
    dsnSet,
    dsnHint: (process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").replace(/^(https:\/\/.{6}).*(@.*)$/, "$1…$2"),
    messageEventId: msgId,
    exceptionEventId: errId,
    flushed,
  });
}
