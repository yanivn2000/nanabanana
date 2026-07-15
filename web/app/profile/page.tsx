"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProfile, useFollows, DEFAULT_PROFILE } from "@/lib/store";
import { Check, Users, ChevronRight, Star } from "lucide-react";
import { ProfileEditor } from "@/components/ProfileEditor";
import { FollowsEditor } from "@/components/FollowsEditor";
import { AuthButton } from "@/components/AuthButton";

export default function ProfilePage() {
  const [p, save, loaded] = useProfile();
  const [follows, saveFollows] = useFollows();
  const router = useRouter();

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-8 lg:max-w-2xl lg:px-8 lg:pb-12">
      <Link href="/" className="eyebrow mb-4 inline-flex items-center gap-1">
        <ChevronRight size={14} /> בית
      </Link>
      <header className="rise mb-6 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)]">
          <Users size={20} />
        </div>
        <div>
          <h1 className="text-[22px] font-bold leading-tight">פרופיל המשפחה</h1>
          <p className="text-[14px] text-[var(--text-2)]">ברירת מחדל לכל טיול · אפשר לשנות פר-טיול</p>
        </div>
      </header>

      {/* account — login lives here on mobile (the top bar is desktop-only) */}
      <div className="rise mb-6 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 shadow-[var(--shadow)]">
        <div className="min-w-0">
          <p className="text-[15px] font-medium">חשבון</p>
          <p className="text-[13.5px] text-[var(--text-2)]">התחברו כדי לשמור את הטיולים בענן ולגשת מכל מכשיר</p>
        </div>
        <div className="shrink-0"><AuthButton showEmail /></div>
      </div>

      {!loaded ? (
        <p className="text-sm text-[var(--text-3)]">טוען…</p>
      ) : (
        <>
          <ProfileEditor value={p} onChange={save} />

          <div className="mt-7 border-t border-[var(--border)] pt-6">
            <div className="mb-3 flex items-center gap-2">
              <Star size={17} className="text-[var(--brand-ink)]" fill="currentColor" />
              <h2 className="text-[16px] font-bold">עוקב אחרי</h2>
            </div>
            <p className="mb-4 text-[14px] text-[var(--text-2)]">
              כשההרכב שלכם מנגן, הקבוצה משחקת או שיש יום מיוחד — בדיוק בתאריכי הטיול — נבליט לכם את זה ⭐
            </p>
            <FollowsEditor value={follows} onChange={saveFollows} />
          </div>

          <div className="mt-7 flex items-center justify-between rounded-[var(--radius-card)] bg-[var(--brand-soft)] px-4 py-3">
            <span className="flex items-center gap-2 text-[14px] text-[var(--brand-ink)]"><Check size={16} /> נשמר אוטומטית במכשיר</span>
            <button onClick={() => save(DEFAULT_PROFILE)} className="text-[13px] text-[var(--brand-ink)] underline">אפס</button>
          </div>
          <button onClick={() => router.back()}
            className="mt-3 w-full rounded-full bg-[var(--brand)] py-3 text-[16px] font-medium text-white">
            סיום
          </button>
        </>
      )}
    </main>
  );
}
