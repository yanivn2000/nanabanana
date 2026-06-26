import { listDestinations } from "@/lib/db";
import { ExploreList } from "./ExploreList";

export const dynamic = "force-dynamic";

export default function ExplorePage() {
  const destinations = listDestinations();
  return (
    <main className="mx-auto max-w-[440px] px-5 pb-28 pt-8">
      <header className="rise mb-5">
        <h1 className="text-[26px] font-bold leading-tight">גלו יעדים</h1>
        <p className="mt-1 text-sm text-[var(--text-2)]">יעדים אהובים על משפחות ישראליות</p>
      </header>
      <ExploreList destinations={destinations} />
    </main>
  );
}
