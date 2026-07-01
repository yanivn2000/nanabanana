import { notFound } from "next/navigation";
import { getDestination, attractionsForMap, insightsForDestination, type Insight } from "@/lib/db";
import { DestinationView } from "./DestinationView";

export const dynamic = "force-dynamic";

export default async function DestinationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dest = await getDestination(Number(id));
  if (!dest) notFound();
  const [attractions, allInsights] = await Promise.all([
    attractionsForMap(dest.id, 200),
    insightsForDestination(dest.id),
  ]);
  // Group attraction-linked insights into a plain object (client-serializable).
  const insights: Record<number, Insight[]> = {};
  for (const ins of allInsights) {
    if (ins.attraction_id == null) continue;
    (insights[ins.attraction_id] ??= []).push(ins);
  }
  return <DestinationView dest={dest} attractions={attractions} insights={insights} />;
}
