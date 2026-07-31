import { TripView } from "./TripView";

export const dynamic = "force-dynamic";

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Editorial is now the DEFAULT view (photo-forward magazine layout inside an
  // .editorial-scope wrapper). The old compact layout is still reachable as an
  // escape hatch at /trip/<id>?v=classic (or ?v=list) for comparison / rollback.
  // Tolerate a trailing slash / whitespace / array form.
  const vRaw = Array.isArray(sp.v) ? sp.v[0] : sp.v;
  const v = String(vRaw ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const classic = v === "classic" || v === "list" || v === "off";
  if (classic) return <TripView tripId={id} />;
  return (
    <div className="editorial-scope">
      <TripView tripId={id} editorial />
    </div>
  );
}
