import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { destinationsWithSharedTrips, listDestinations, listPublicSharedTripSlugs } from "@/lib/db";

// Cached for an hour instead of force-dynamic. The sitemap hit the database on
// EVERY request, so a crawler arrived at a cold serverless function plus two
// Supabase queries — the first fetch measured 3.4s, and a slow or failed fetch is
// exactly what Google reports as "Couldn't fetch". The city list changes rarely;
// an hour-old sitemap is not a problem, a timed-out one is.
export const revalidate = 3600;

// Home + every city page + every city community gallery + every public shared
// trip. The shared-trip URLs are the SEO play (Hebrew long-tail "טיול X ימים").
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [dests, trips, withTrips] = await Promise.all([
    listDestinations().catch(() => []),
    listPublicSharedTripSlugs().catch(() => []),
    destinationsWithSharedTrips().catch(() => [] as number[]),
  ]);
  const hasTrips = new Set(withTrips);

  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
  ];

  for (const d of dests) {
    entries.push({ url: `${SITE_URL}/destination/${d.slug}`, lastModified: now, changeFrequency: "weekly", priority: 0.8 });
    // Only a gallery that has something in it. An empty "מסלולים של מטיילים"
    // page is a promise the site cannot keep yet, and offering 61 of them to a
    // brand-new domain is the fastest way to be read as a thin site.
    if (hasTrips.has(d.id)) {
      entries.push({ url: `${SITE_URL}/destination/${d.slug}/trips`, lastModified: now, changeFrequency: "weekly", priority: 0.6 });
    }
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
