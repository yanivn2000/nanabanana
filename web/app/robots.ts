import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Allow indexing of the public content; keep the admin, APIs and user-private
// trip workspace out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/trip/", "/trips"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
