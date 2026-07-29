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
  // Feature flag: /trip/<id>?v=editorial renders the same TripView inside an
  // .editorial-scope wrapper (a re-skin via scoped tokens/CSS). The default
  // route is untouched — no wrapper, identical markup — so the live page is safe.
  // Tolerate a trailing slash / whitespace / array form (?v=editorial/ still works).
  const vRaw = Array.isArray(sp.v) ? sp.v[0] : sp.v;
  const v = String(vRaw ?? "").trim().replace(/\/+$/, "").toLowerCase();
  if (v === "editorial") {
    return (
      <div className="editorial-scope">
        <TripView tripId={id} />
      </div>
    );
  }
  return <TripView tripId={id} />;
}
