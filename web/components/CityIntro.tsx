import Link from "next/link";
import { ChevronRight } from "lucide-react";

// The city page had no <h1> and no headings at all — the editorial hero moved the
// city name into the nav bar, and a crawler saw a page that opened with a travel-
// card advert. This is the page's actual subject, stated once, in the words an
// Israeli searches with, followed by two sentences of what is genuinely here.
// Every number is read from the database; nothing is padded.
export function CityIntro({ city, country, flag, slug, communityCount, mustSee, total, areas, streets }: {
  city: string; country: string | null; flag: string; slug: string; communityCount: number;
  mustSee: number; total: number; areas: number; streets: number;
}) {
  const layer = [
    areas ? `${areas} שכונות` : null,
    streets ? `${streets} רחובות מומלצים` : null,
  ].filter(Boolean).join(" ו־");
  return (
    <header className="mx-auto max-w-6xl px-5 pb-5 pt-5 lg:px-8">
      <nav aria-label="פירורי לחם" className="flex items-center gap-1.5 text-[13px] text-[var(--text-2)]">
        <Link href="/" className="inline-flex items-center gap-1 hover:text-[var(--brand-ink)]">
          <ChevronRight size={13} /> בית
        </Link>
        <span aria-hidden>·</span>
        <span>{country || ""}</span>
      </nav>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="serif text-[27px] font-bold leading-tight lg:text-[32px]">
          <span aria-hidden className="text-[0.72em]">{flag}</span> טיול ל{city}
        </h1>
        {/* Community trips sat inside the filter toolbar, where it read as a
            filter. It belongs beside the city name: it is what OTHER travellers
            did here, not a way to narrow the list. */}
        {communityCount > 0 && (
          <Link href={`/destination/${slug}/trips`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#ff5a5f]/40 bg-[#ff5a5f]/8 px-3 py-1 text-[12.5px] font-medium text-[#d63d42] transition hover:bg-[#ff5a5f]/15">
            ❤️ {communityCount} טיולים של מטיילים
          </Link>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[var(--text-2)]">
        {mustSee > 0
          ? <>כל מה שצריך כדי לתכנן טיול ל{city}: <strong>{mustSee} אתרי חובה</strong> מתוך {total} מקומות,
            כל אחד עם תיאור בעברית, תמונה, זמן שהייה ומיקום על המפה{layer ? <> — לצד {layer}</> : null}.</>
          : <>כל מה שצריך כדי לתכנן טיול ל{city}: {total} מקומות עם תיאור בעברית, תמונה ומיקום על המפה.</>}
        {" "}
        סמנו מה מעניין אתכם ו־Yalle יבנה מסלול יום־אחר־יום — לשלושה ימים או לשבוע, עם ילדים או בלי,
        עם זמני הגעה, הליכה בין העצירות והפסקות אוכל. בחינם, בלי הרשמה.
      </p>
    </header>
  );
}
