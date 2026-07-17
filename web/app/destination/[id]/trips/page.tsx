import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getDestination, listSharedTripsForDestination } from "@/lib/db";
import { CommunityTripsGrid } from "./CommunityTripsGrid";

export const dynamic = "force-dynamic";

// The per-city community gallery — every trip travelers shared for this city,
// ranked by likes. "קחו טיול מוכן" = one-click remix from a card.
export default async function CityTripsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dest = await getDestination(Number(id));
  if (!dest) notFound();
  const trips = await listSharedTripsForDestination(dest.id);
  const cityHe = dest.city_he || dest.city;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-4 lg:px-8">
      <Link href={`/destination/${dest.id}`} className="eyebrow mb-3 inline-flex items-center gap-1 text-[var(--text-2)]">
        <ChevronRight size={14} /> {cityHe}
      </Link>
      <h1 className="serif text-[26px] font-bold leading-tight lg:text-[30px]">
        טיולים של מטיילים ב{cityHe}
      </h1>
      <p className="mt-1.5 text-[14.5px] text-[var(--text-2)]">
        תוכניות אמיתיות ששיתפו מטיילים אחרים. אהבתם אחת? העתיקו אותה אליכם בקליק וערכו כרצונכם.
      </p>

      <div className="mt-5">
        <CommunityTripsGrid destId={dest.id} cityHe={cityHe} trips={trips} />
      </div>
    </main>
  );
}
