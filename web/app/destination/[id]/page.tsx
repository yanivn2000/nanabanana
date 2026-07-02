import { notFound } from "next/navigation";
import { getDestination, attractionsForMap, insightsForDestination, type Insight } from "@/lib/db";
import { passesForCity } from "@/lib/passes";
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
  // Specific places we don't have as attractions (hotels, food, tours) — grouped
  // by their free-text name. City-wide tips (place = the city, or blank) are
  // intentionally left out.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const cityTerms = new Set([norm(dest.city), norm(dest.city_he ?? "")].filter(Boolean));
  const placeMap = new Map<string, Insight[]>();
  for (const ins of allInsights) {
    if (ins.attraction_id != null) {
      (insights[ins.attraction_id] ??= []).push(ins);
      continue;
    }
    const pn = (ins.place_name ?? "").trim();
    if (pn.length < 3 || cityTerms.has(norm(pn))) continue; // city-wide / blank → skip
    (placeMap.get(pn) ?? placeMap.set(pn, []).get(pn)!).push(ins);
  }
  // Sort places by how many travelers mentioned them (consensus first).
  const placeGroups = [...placeMap.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => b.items.length - a.items.length);

  return (
    <DestinationView
      dest={dest} attractions={attractions} insights={insights} placeGroups={placeGroups}
      passes={passesForCity(dest.city, dest.city_he)}
    />
  );
}
