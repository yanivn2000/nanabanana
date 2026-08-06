import Link from "next/link";
import { ChevronRight } from "lucide-react";

// The city page had no <h1> and no headings at all — the editorial hero moved the
// city name into the nav bar, and a crawler saw a page that opened with a travel-
// card advert. This is the page's actual subject, stated once, in the words an
// Israeli searches with, followed by two sentences of what is genuinely here.
// Every number is read from the database; nothing is padded.
export function CityIntro({ city, country, flag, mustSee, total, areas, streets }: {
  city: string; country: string | null; flag: string;
  mustSee: number; total: number; areas: number; streets: number;
}) {
  const layer = [
    areas ? `${areas} שכונות` : null,
    streets ? `${streets} רחובות מומלצים` : null,
  ].filter(Boolean).join(" ו־");
  return (
    <header className="mx-auto max-w-6xl px-5 pt-5 lg:px-8">
      <nav aria-label="פירורי לחם" className="flex items-center gap-1.5 text-[13px] text-[var(--text-2)]">
        <Link href="/" className="inline-flex items-center gap-1 hover:text-[var(--brand-ink)]">
          <ChevronRight size={13} /> בית
        </Link>
        <span aria-hidden>·</span>
        <span>{country || ""}</span>
      </nav>
      <h1 className="serif mt-1 text-[27px] font-bold leading-tight lg:text-[32px]">
        <span aria-hidden className="text-[0.72em]">{flag}</span> טיול ל{city}
      </h1>
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
