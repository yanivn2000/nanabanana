import Link from "next/link";
import { notFound } from "next/navigation";
import { getDestination, attractionsForMap } from "@/lib/db";
import { MapClient } from "@/components/MapClient";
import {
  ChevronRight, Star, Mountain, Landmark, Trees, Dumbbell,
  UtensilsCrossed, ShoppingBag, MapPin,
} from "lucide-react";

export const dynamic = "force-dynamic";

const CAT: Record<string, { he: string; Icon: typeof Mountain; color: string; soft: string }> = {
  nature: { he: "טבע", Icon: Trees, color: "var(--brand-ink)", soft: "var(--brand-soft)" },
  museum: { he: "מוזיאון", Icon: Landmark, color: "var(--blue)", soft: "var(--blue-soft)" },
  attraction: { he: "אטרקציה", Icon: Mountain, color: "var(--amber)", soft: "var(--amber-soft)" },
  sport: { he: "ספורט", Icon: Dumbbell, color: "var(--amber)", soft: "var(--amber-soft)" },
  food: { he: "אוכל", Icon: UtensilsCrossed, color: "var(--blue)", soft: "var(--blue-soft)" },
  shopping: { he: "קניות", Icon: ShoppingBag, color: "var(--blue)", soft: "var(--blue-soft)" },
};
function cat(c: string) {
  return CAT[c] ?? { he: c, Icon: MapPin, color: "var(--text-2)", soft: "var(--surface-2)" };
}

export default async function DestinationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dest = getDestination(Number(id));
  if (!dest) notFound();
  const attractions = attractionsForMap(dest.id, 200);

  return (
    <main className="mx-auto max-w-[440px] pb-12">
      <header className="rise bg-[var(--brand)] px-5 pb-6 pt-7 text-white">
        <Link href="/" className="mb-4 flex items-center gap-1 text-[13px] text-[var(--brand-soft)]">
          <ChevronRight size={16} /> בית
        </Link>
        <h1 className="text-[27px] font-bold leading-tight">{dest.city}</h1>
        <p className="mt-1 text-sm text-[var(--brand-soft)]">
          {dest.country} · {dest.attraction_count.toLocaleString("he")} אטרקציות במאגר
        </p>
      </header>

      {/* live map of real collected attractions */}
      <div className="h-[280px] w-full overflow-hidden">
        <MapClient attractions={attractions} center={[dest.lat, dest.lng]} />
      </div>

      <section className="px-5">
        <h2 className="mb-3 mt-6 text-[17px] font-bold">אטרקציות</h2>
        <div className="flex flex-col gap-2.5">
          {attractions.map((a) => {
            const m = cat(a.category);
            return (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]"
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-[12px]"
                     style={{ background: m.soft, color: m.color }}>
                  <m.Icon size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] font-medium leading-tight">
                      {a.name_he || a.name_en}
                    </p>
                    {!!a.family_score && (
                      <span className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-[var(--brand-ink)]">
                        <Star size={13} fill="currentColor" /> {a.family_score}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-[var(--text-3)]">{m.he}</p>
                  {a.tips_he && (
                    <p className="mt-1.5 text-[13px] leading-snug text-[var(--text-2)]">{a.tips_he}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
