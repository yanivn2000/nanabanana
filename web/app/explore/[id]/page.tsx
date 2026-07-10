import { notFound } from "next/navigation";
import { getDestination, topAttractions, insightsForDestination } from "@/lib/db";
import { ExploreFlow } from "./ExploreFlow";

export const dynamic = "force-dynamic";

// The "חקירת יעד" (Explore) flow for one destination — a parallel path to the
// existing app. Loads the destination + its (taste-tagged) attractions and
// hands off to the client stepper.
export default async function ExploreDestinationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dest = await getDestination(Number(id));
  if (!dest) notFound();
  const [attractions, insights] = await Promise.all([
    topAttractions(dest.id, 200),
    insightsForDestination(dest.id), // verified traveller knowledge for step-3 detail
  ]);
  return <ExploreFlow dest={dest} attractions={attractions} insights={insights} />;
}
