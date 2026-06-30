"use client";

import { useProfile, DEFAULT_PROFILE } from "@/lib/store";
import { Check, Users } from "lucide-react";
import { ProfileEditor } from "@/components/ProfileEditor";

export default function ProfilePage() {
  const [p, save, loaded] = useProfile();

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-8 lg:max-w-2xl lg:px-8 lg:pb-12">
      <header className="rise mb-6 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)]">
          <Users size={20} />
        </div>
        <div>
          <h1 className="text-[22px] font-bold leading-tight">פרופיל המשפחה</h1>
          <p className="text-[13px] text-[var(--text-2)]">ברירת מחדל לכל טיול · אפשר לשנות פר-טיול</p>
        </div>
      </header>

      {!loaded ? (
        <p className="text-sm text-[var(--text-3)]">טוען…</p>
      ) : (
        <>
          <ProfileEditor value={p} onChange={save} />
          <div className="mt-6 flex items-center justify-between rounded-[var(--radius-card)] bg-[var(--brand-soft)] px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] text-[var(--brand-ink)]"><Check size={16} /> נשמר אוטומטית במכשיר</span>
            <button onClick={() => save(DEFAULT_PROFILE)} className="text-[12px] text-[var(--brand-ink)] underline">אפס</button>
          </div>
        </>
      )}
    </main>
  );
}
