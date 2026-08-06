import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getDestinationBySlug, listSharedTripsForDestination } from "@/lib/db";
import type { Metadata } from "next";
import { CommunityTripsGrid } from "./CommunityTripsGrid";
import { canonical } from "@/lib/seo";

export const dynamic = "force-dynamic";

// "מסלולי טיול ל…" is its own search — people look for a ready itinerary before
// they look for a planner. This page is the answer, so it gets its own title.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const dest = await getDestinationBySlug(slug).catch(() => null);
  if (!dest) return {};
  const city = dest.city_he || dest.city;
  const trips = await listSharedTripsForDestination(dest.id).catch(() => []);
  const title = `מסלולי טיול ל${city} — ${trips.length ? `${trips.length} מסלולים` : "מסלולים"} של מטיילים | Yalle`;
  const description = `מסלולים אמיתיים ל${city} שמטיילים בנו ושיתפו — יום־אחר־יום, עם מפה וזמנים. אפשר לקחת מסלול מוכן ולשנות אותו לעצמכם, בחינם.`;
  return {
    title, description,
    // An empty gallery is a real page for a visitor who followed a link, but it
    // is nothing for a searcher — keep it out of the index until it has content.
    ...(trips.length === 0 ? { robots: { index: false, follow: true } } : {}),
    alternates: { canonical: canonical(`/destination/${dest.slug}/trips`) },
    openGraph: { title, description, type: "website", locale: "he_IL", url: canonical(`/destination/${dest.slug}/trips`) },
  };
}

// The per-city community gallery — every trip travelers shared for this city,
// ranked by likes. "קחו טיול מוכן" = one-click remix from a card.
export default async function CityTripsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dest = await getDestinationBySlug(slug);
  if (!dest) notFound();
  const trips = await listSharedTripsForDestination(dest.id);
  const cityHe = dest.city_he || dest.city;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-4 lg:px-8">
      <Link href={`/destination/${dest.slug}`} className="eyebrow mb-3 inline-flex items-center gap-1 text-[var(--text-2)]">
        <ChevronRight size={14} /> {cityHe}
      </Link>
      <h1 className="serif text-[26px] font-bold leading-tight lg:text-[30px]">
        טיולים של מטיילים ב{cityHe}
      </h1>
      <p className="mt-1.5 text-[14.5px] text-[var(--text-2)]">
        תוכניות אמיתיות ששיתפו מטיילים אחרים. אהבתם אחת? העתיקו אותה אליכם בקליק וערכו כרצונכם.
      </p>

      <div className="mt-5">
        <CommunityTripsGrid destId={dest.id} destSlug={dest.slug} cityHe={cityHe} trips={trips} />
      </div>
    </main>
  );
}
