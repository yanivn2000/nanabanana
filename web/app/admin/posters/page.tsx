import Link from "next/link";
import { adminEmail } from "@/lib/admin";
import { listDestinations, getPosterPicks } from "@/lib/db";
import { POSTER_SLUG } from "@/lib/posters";
import { PosterPicker } from "./PosterPicker";

export const dynamic = "force-dynamic";

export default async function AdminPostersPage() {
  const email = await adminEmail();
  if (!email) {
    return (
      <main className="mx-auto max-w-[440px] px-5 pt-20 text-center">
        <h1 className="serif text-[24px]">אזור ניהול</h1>
        <p className="mt-3 text-[14px] text-[var(--text-2)]">
          העמוד הזה מוגבל לצוות. התחברו עם חשבון המנהל כדי להיכנס.
        </p>
        <Link href="/login" className="mt-5 inline-block rounded-full bg-[var(--brand)] px-5 py-2.5 text-[14px] font-medium text-white">
          התחברות
        </Link>
      </main>
    );
  }

  const [dests, picks] = await Promise.all([listDestinations(), getPosterPicks()]);
  const cities = dests
    .map((d) => ({ id: d.id, city: d.city_he || d.city, slug: POSTER_SLUG[d.id] ?? null }))
    .sort((a, b) => a.city.localeCompare(b.city, "he"));

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-8 lg:px-8">
      <header className="mb-6">
        <p className="eyebrow">אזור ניהול · {email}</p>
        <h1 className="serif mt-1 text-[28px] font-bold lg:text-[34px]">תמונות ערים</h1>
        <p className="mt-1 text-[14px] text-[var(--text-2)]">
          בחרו תמונה אמיתית לכל עיר. הבחירה נשמרת; ההעלאה (חיתוך + פרסום) מתבצעת בהרצת <code>finalize_posters.py</code>.
        </p>
      </header>
      <PosterPicker cities={cities} initialPicks={picks} />
    </main>
  );
}
