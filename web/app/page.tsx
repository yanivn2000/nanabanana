import Link from "next/link";
import { listDestinations } from "@/lib/db";
import { ArrowLeft, Plus, Sparkles, Compass } from "lucide-react";
import { YalleMark } from "@/components/YalleMark";
import { ExploreList } from "./explore/ExploreList";

export const dynamic = "force-dynamic";

export default async function Home() {
  const destinations = await listDestinations();

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-24 pt-8 lg:max-w-6xl lg:px-8 lg:pb-12">
      {/* header */}
      <header className="rise mb-7 flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--text-2)]">ערב טוב, יניב 👋</p>
          <h1 className="mt-0.5 text-[26px] font-bold leading-tight lg:text-[34px]">לאן טסים?</h1>
        </div>
        <div className="lg:hidden">
          <YalleMark size={38} />
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-3 lg:gap-4">
      {/* hero CTA → trips */}
      <Link
        href="/trips"
        className="rise rise-1 block rounded-[var(--radius-card)] bg-[var(--accent)] p-5 text-white shadow-[var(--shadow)] lg:col-span-2 lg:p-8"
      >
        <div className="flex items-center gap-2 text-[13px] text-[var(--accent-soft)]">
          <Sparkles size={15} /> מתכננים את הבא
        </div>
        <p className="serif mt-2 text-[26px] leading-tight lg:text-[32px]">הטיולים שלי</p>
        <p className="mt-1 text-sm text-[var(--accent-soft)]">בנו טיול חדש — לפי העדפות או לפי מלונות</p>
      </Link>

      {/* new trip */}
      <Link
        href="/trips"
        className="rise rise-2 mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] py-4 text-[15px] font-medium text-[var(--text-2)] lg:mt-0 lg:flex-col lg:py-0"
      >
        <Plus size={18} /> טיול חדש
      </Link>
      </div>

      {/* don't know where? get a recommendation */}
      <Link
        href="/recommend"
        className="rise rise-2 mt-3 flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]"
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <Sparkles size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">לא יודעים לאן?</p>
          <p className="text-[13px] text-[var(--text-2)]">קבלו המלצת יעד לפי המשפחה והעונה</p>
        </div>
        <ArrowLeft size={18} className="text-[var(--text-3)]" />
      </Link>

      {/* on-trip mode */}
      <Link
        href="/now"
        className="rise rise-2 mt-3 flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]"
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)]">
          <Compass size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">אני בטיול עכשיו</p>
          <p className="text-[13px] text-[var(--text-2)]">מה קרוב אליי + ניווט</p>
        </div>
        <ArrowLeft size={18} className="text-[var(--text-3)]" />
      </Link>

      {/* discover destinations — search + region-divided list */}
      <section className="rise rise-3 mt-10">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="serif text-[24px] font-bold leading-tight lg:text-[30px]">גלו יעדים</h2>
            <p className="mt-0.5 text-[13.5px] text-[var(--text-2)]">יעדים אהובים על משפחות ישראליות</p>
          </div>
          {destinations.length > 0 && (
            <span className="shrink-0 text-xs text-[var(--text-3)]">{destinations.length} יעדים</span>
          )}
        </div>

        <ExploreList destinations={destinations} />
      </section>
    </main>
  );
}
