import { SAMPLE_TRIP } from "@/lib/sample";
import { listDestinations } from "@/lib/db";
import { TripView } from "./TripView";

export const dynamic = "force-dynamic";

export default function TripPage() {
  // Use the top destination from the DB as the source of real attractions.
  const top = listDestinations()[0];
  return <TripView trip={SAMPLE_TRIP} city={top?.city} />;
}
