import { notFound } from "next/navigation";
import { getDestination, attractionsForMap } from "@/lib/db";
import { DestinationView } from "./DestinationView";

export const dynamic = "force-dynamic";

export default async function DestinationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dest = getDestination(Number(id));
  if (!dest) notFound();
  const attractions = attractionsForMap(dest.id, 200);
  return <DestinationView dest={dest} attractions={attractions} />;
}
