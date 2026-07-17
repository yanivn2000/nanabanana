"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Catches uncaught React render errors, reports them to Sentry (inert without a
// DSN), and shows a calm Hebrew fallback instead of a blank screen.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f7f5ef", color: "#20342f" }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>משהו השתבש</h1>
          <p style={{ fontSize: 15, color: "#556", marginBottom: 20 }}>
            נתקלנו בתקלה זמנית. אפשר לנסות שוב.
          </p>
          <button onClick={reset}
            style={{ background: "#0e6b5e", color: "#fff", border: 0, borderRadius: 999, padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            נסו שוב
          </button>
        </div>
      </body>
    </html>
  );
}
