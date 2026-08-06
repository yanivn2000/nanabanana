import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDestination, attractionsForMap, insightsForDestination, countSharedTripsForDestination, headlineAreasForCity, approvedStreetsForCity, type Insight } from "@/lib/db";
import { breadcrumbs, canonical, cityDescription, cityTitle, jsonLd } from "@/lib/seo";
import { passesForCity, passCovers } from "@/lib/passes";
import { isEditor } from "@/lib/admin";
import { DestinationView } from "./DestinationView";
import { CityIntro } from "@/components/CityIntro";
import { countryFlag } from "@/lib/labels";

export const dynamic = "force-dynamic";

// Every city page had been inheriting the site-wide title, so all 65 of them
// competed in search as the same page. This gives each one the words an Israeli
// actually types — "טיול ל…" plus the city — and real numbers from the DB.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const dest = await getDestination(Number(id)).catch(() => null);
  if (!dest) return {};
  const city = dest.city_he || dest.city;
  const [attrs, areas, streets] = await Promise.all([
    attractionsForMap(dest.id, 2000).catch(() => []),
    headlineAreasForCity(dest.id).catch(() => []),
    approvedStreetsForCity(dest.id).catch(() => []),
  ]);
  const mustSee = attrs.filter((a) => a.must_see === 1).length;
  const title = cityTitle(city);
  const description = cityDescription(city, { mustSee, total: attrs.length, areas: areas.length, streets: streets.length });
  const image = attrs.find((a) => a.must_see === 1 && a.image_url)?.image_url ?? undefined;
  return {
    title, description,
    alternates: { canonical: canonical(`/destination/${dest.id}`) },
    openGraph: {
      title, description, type: "website", locale: "he_IL",
      url: canonical(`/destination/${dest.id}`),
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

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

  const city = dest.city_he || dest.city;
  const mustSeeList = attractions.filter((a) => a.must_see === 1);
  // Structured data, server-rendered: what the city is, where it sits, and its
  // headline sights. The page's own content is built on the client, which a
  // crawler reads too late — this arrives in the HTML.
  const ld = [
    breadcrumbs([{ name: "בית", path: "/" }, { name: city, path: `/destination/${dest.id}` }]),
    {
      "@context": "https://schema.org",
      "@type": "TouristDestination",
      name: city,
      alternateName: dest.city,
      url: canonical(`/destination/${dest.id}`),
      ...(dest.country_he || dest.country ? { addressCountry: dest.country_he || dest.country } : {}),
      ...(dest.lat != null && dest.lng != null
        ? { geo: { "@type": "GeoCoordinates", latitude: dest.lat, longitude: dest.lng } } : {}),
      includesAttraction: mustSeeList.slice(0, 15).map((a) => ({
        "@type": "TouristAttraction",
        name: a.name_he || a.name_en,
        ...(a.image_url ? { image: a.image_url } : {}),
      })),
    },
  ];

  const view = (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
      <CityIntro city={city} country={dest.country_he || dest.country} flag={countryFlag(dest.country)}
        mustSee={mustSeeList.length} total={attractions.length}
        areas={areas.length} streets={streets.length} />
      <DestinationView
      dest={dest} attractions={attractions} insights={insights} placeGroups={placeGroups}
      passes={passes} coveredIds={coveredIds} isEditor={editor} communityCount={communityCount}
      areas={areas} streets={streets} editorial={editorial}
      />
    </>
  );
  // Feature flag: /destination/<id>?v=editorial renders the same view inside an
  // .editorial-scope wrapper (re-skin via scoped tokens/CSS). Default is untouched.
  return editorial ? <div className="editorial-scope">{view}</div> : view;
}
