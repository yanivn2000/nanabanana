import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedTrip, bumpSharedTripViews, getTripComments } from "@/lib/db";
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
  return <SharedTripView trip={trip} comments={comments} />;
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
  const desc = [
    `${trip.itinerary.days.length} ימים`,
    `${stops} עצירות`,
    trip.composition ?? undefined,
    "תוכנית יום-אחר-יום עם מפה",
  ].filter(Boolean).join(" · ");
  return {
    title: `${trip.title} · Yalle`,
    description: desc,
    openGraph: {
      title: trip.title,
      description: desc,
      type: "article",
      locale: "he_IL",
    },
    twitter: { card: "summary_large_image", title: trip.title, description: desc },
  };
}
