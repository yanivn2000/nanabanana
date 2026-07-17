// The canonical public origin, used for metadataBase, robots and the sitemap.
// Override with NEXT_PUBLIC_SITE_URL once a custom domain is set; otherwise use
// Vercel's production URL, falling back to the current deployment host.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://nanabanana-nine.vercel.app")
).replace(/\/$/, "");
