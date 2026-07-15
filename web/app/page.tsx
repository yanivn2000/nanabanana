import { listDestinations, destinationSummaries } from "@/lib/db";
import { YalleMark } from "@/components/YalleMark";
import { ExploreList } from "./explore/ExploreList";
import { HomeTrips } from "./HomeTrips";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [destinations, summaries] = await Promise.all([
    listDestinations(),
    destinationSummaries(), // per-city category counts → the card chips
  ]);

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-24 pt-5 lg:max-w-6xl lg:px-8 lg:pb-12">
      {/* header */}
      <header className="rise mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--text-2)]">ערב טוב, יניב 👋</p>
          <h1 className="mt-0.5 text-[24px] font-bold leading-tight lg:text-[30px]">לאן טסים?</h1>
        </div>
        <div className="lg:hidden">
          <YalleMark size={38} />
        </div>
      </header>

      {/* my trips + the two entry CTAs — one compact row of square tiles */}
      <HomeTrips />

      {/* discover destinations — search + region-divided list */}
      <section className="rise rise-3 mt-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="serif text-[24px] font-bold leading-tight lg:text-[30px]">גלו יעדים</h2>
            <p className="mt-0.5 text-[14.5px] text-[var(--text-2)]">יעדים אהובים על משפחות ישראליות</p>
          </div>
          {destinations.length > 0 && (
            <span className="shrink-0 text-xs text-[var(--text-3)]">{destinations.length} יעדים</span>
          )}
        </div>

        <ExploreList destinations={destinations} summaries={summaries} />
      </section>
    </main>
  );
}
