import { notFound } from "next/navigation";
import { getDestination, topAttractions } from "@/lib/db";
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
  const attractions = await topAttractions(dest.id, 200);
  return <ExploreFlow dest={dest} attractions={attractions} />;
}
