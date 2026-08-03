import { notFound } from "next/navigation";
import { getDestination, attractionsForMap, insightsForDestination, countSharedTripsForDestination, headlineAreasForCity, approvedStreetsForCity, type Insight } from "@/lib/db";
import { passesForCity, passCovers } from "@/lib/passes";
import { isEditor } from "@/lib/admin";
import { DestinationView } from "./DestinationView";

export const dynamic = "force-dynamic";

export default async function DestinationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Editorial is now the DEFAULT city view (hero + photo-card tabs). The old flat
  // list is still reachable at /destination/<id>?v=classic (or ?v=list) for rollback.
  const vRaw = Array.isArray(sp.v) ? sp.v[0] : sp.v;
  const v = String(vRaw ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const editorial = !(v === "classic" || v === "list" || v === "off");
  const dest = await getDestination(Number(id));
  if (!dest) notFound();
  const [attractions, allInsights, editor, communityCount, areas, streets] = await Promise.all([
    attractionsForMap(dest.id, 2000),   // load the whole city (rows are light); the list paginates client-side
    insightsForDestination(dest.id),
    isEditor(),
    countSharedTripsForDestination(dest.id),
    headlineAreasForCity(dest.id),
    approvedStreetsForCity(dest.id),   // pickable streets (search + under neighbourhoods)
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

  const passes = passesForCity(dest.city, dest.city_he);
  // Attractions covered by a pass's curated include-list → shown with a 💳 tag.
  const coveredIds = attractions
    .filter((a) => passes.some((p) => passCovers(p, a.name_en, a.name_he)))
    .map((a) => a.id);

  const view = (
    <DestinationView
      dest={dest} attractions={attractions} insights={insights} placeGroups={placeGroups}
      passes={passes} coveredIds={coveredIds} isEditor={editor} communityCount={communityCount}
      areas={areas} streets={streets} editorial={editorial}
    />
  );
  // Feature flag: /destination/<id>?v=editorial renders the same view inside an
  // .editorial-scope wrapper (re-skin via scoped tokens/CSS). Default is untouched.
  return editorial ? <div className="editorial-scope">{view}</div> : view;
}
