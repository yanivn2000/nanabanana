import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { listDestinations, listPublicSharedTripSlugs } from "@/lib/db";

// Cached for an hour instead of force-dynamic. The sitemap hit the database on
// EVERY request, so a crawler arrived at a cold serverless function plus two
// Supabase queries — the first fetch measured 3.4s, and a slow or failed fetch is
// exactly what Google reports as "Couldn't fetch". The city list changes rarely;
// an hour-old sitemap is not a problem, a timed-out one is.
export const revalidate = 3600;

// Home + every city page + every city community gallery + every public shared
// trip. The shared-trip URLs are the SEO play (Hebrew long-tail "טיול X ימים").
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [dests, trips] = await Promise.all([
    listDestinations().catch(() => []),
    listPublicSharedTripSlugs().catch(() => []),
  ]);

  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
  ];

  for (const d of dests) {
    entries.push(
      { url: `${SITE_URL}/destination/${d.id}`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
      { url: `${SITE_URL}/destination/${d.id}/trips`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    );
  }

  for (const t of trips) {
    entries.push({
      url: `${SITE_URL}/t/${t.slug}`,
      lastModified: t.updated_at ? new Date(t.updated_at) : now,
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  return entries;
}
