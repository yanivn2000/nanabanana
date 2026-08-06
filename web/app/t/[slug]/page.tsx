import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedTrip, bumpSharedTripViews, getTripComments } from "@/lib/db";
import { canonical, jsonLd } from "@/lib/seo";
import { SharedTripView } from "./SharedTripView";

export const dynamic = "force-dynamic";

// Public, read-only view of a shared trip — the link that gets posted in the
// Facebook groups. No login needed; comments + remix keep visitors here.
export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const trip = await getSharedTrip(slug);
  if (!trip) notFound();
  await bumpSharedTripViews(slug); // simple social proof
  const comments = await getTripComments(trip.id);
  // A shared trip IS an itinerary — say so in the markup. schema.org/TouristTrip
  // with the days as sub-trips is what lets a result show as a real itinerary
  // rather than an anonymous page.
  const ld = {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    name: trip.title,
    url: canonical(`/t/${slug}`),
    inLanguage: "he-IL",
    ...(trip.composition ? { touristType: trip.composition } : {}),
    ...(trip.city_he || trip.city
      ? { arrivalLocation: { "@type": "City", name: trip.city_he || trip.city } } : {}),
    itinerary: trip.itinerary.days.map((d, i) => ({
      "@type": "ItemList",
      name: d.label || `יום ${i + 1}`,
      numberOfItems: d.stops.length,
      itemListElement: d.stops.slice(0, 12).map((s, j) => ({
        "@type": "ListItem", position: j + 1, name: s.name,
      })),
    })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
      <SharedTripView trip={trip} comments={comments} />
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const trip = await getSharedTrip(slug);
  if (!trip) return { title: "Yalle" };
  const stops = trip.itinerary.days.reduce((n, d) => n + d.stops.length, 0);
  const days = trip.itinerary.days.length;
  const city = trip.city_he || trip.city;
  // The long-tail query is "טיול לאמסטרדם ללא ילדים 4 ימים" — the days and the
  // audience ARE in the row, and they were reaching only the description. Every
  // Amsterdam trip therefore shared one title and competed with itself and with
  // the city page. The title says who and how long now.
  const audience = trip.composition?.includes("ילד") ? "עם ילדים"
    : trip.composition ? "לזוגות" : null;
  const headline = city
    ? [`טיול ל${city}`, `${days} ימים`, audience].filter(Boolean).join(" · ")
    : trip.title;
  const desc = [
    `מסלול ${days} ימים ב${city ?? ""}`.trim(),
    `${stops} עצירות`,
    trip.composition ?? undefined,
    "יום־אחר־יום עם שעות, מפה והפסקות אוכל. אפשר לקחת אותו ולשנות לעצמכם, בחינם.",
  ].filter(Boolean).join(" · ");
  return {
    alternates: { canonical: canonical(`/t/${slug}`) },
    title: `${headline} | Yalle`,
    description: desc,
    openGraph: {
      title: headline,
      description: desc,
      type: "article",
      locale: "he_IL",
    },
    twitter: { card: "summary_large_image", title: headline, description: desc },
  };
}
