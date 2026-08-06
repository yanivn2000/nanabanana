// The canonical public origin, used for metadataBase, robots and the sitemap.
// Override with NEXT_PUBLIC_SITE_URL once a custom domain is set; otherwise use
// Vercel's production URL, falling back to the current deployment host.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://nanabanana-nine.vercel.app")
).replace(/\/$/, "");

// The origin a SHARED link must carry. window.location.origin is wrong for this:
// a trip shared while browsing the Vercel deployment URL went out to Facebook as
// nanabanana-nine.vercel.app — the wrong brand on the link, and the inbound value
// landing on a domain nobody types. Localhost is kept so dev links stay usable.
export const PUBLIC_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || "https://yalle.co";
export function shareOrigin(): string {
  if (typeof window === "undefined") return PUBLIC_ORIGIN;
  const { origin, hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1" ? origin : PUBLIC_ORIGIN;
}
