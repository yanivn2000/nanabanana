"use client";

import type { FamilyProfile } from "@/lib/store";
import type { Itinerary } from "@/lib/trip-types";
import { estimateItinerary } from "@/lib/budget";

const eur = (n: number) => `≈ €${n.toLocaleString("he")}`;

// Per-trip budget: a rough cost estimate from the itinerary (entries by price
// band × travelers + a food/transport allowance) vs. an optional daily target. (#15)
export function BudgetPanel({
  itinerary, profile, value, onChange,
}: {
  itinerary: Itinerary | null;
  profile: FamilyProfile;
  value?: { dailyTarget?: number };
  onChange: (b: { dailyTarget?: number }) => void;
}) {
  const est = estimateItinerary(itinerary, profile);
  const days = est.perDay.length;
  const target = value?.dailyTarget;
  const over = target != null && est.avgDaily > target;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-[var(--text-2)]">
        נוסעים: {est.adults} מבוגרים{est.kids ? ` · ${est.kids} ילדים` : ""} · סגנון {profile.budget}
      </p>

      <div>
        <label className="mb-1 block text-[13px] font-medium">תקציב יומי למשפחה (€)</label>
        <input type="number" min={0} inputMode="numeric"
          value={target ?? ""} placeholder="לא הוגדר"
          onChange={(e) => onChange({ dailyTarget: e.target.value ? Number(e.target.value) : undefined })}
          className="w-32 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[14px] outline-none" />
      </div>

      {days === 0 ? (
        <p className="text-[13px] text-[var(--text-3)]">בנו לו״ז כדי לראות הערכת עלויות מפורטת.</p>
      ) : (
        <>
          <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-[var(--text-2)]">הערכת עלות לטיול ({days} ימים)</span>
              <span className="text-[18px] font-bold">{eur(est.total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[12px] text-[var(--text-3)]">
              <span>ממוצע ליום</span>
              <span style={{ color: over ? "var(--amber)" : "var(--text-2)", fontWeight: 500 }}>
                {eur(est.avgDaily)}{target != null ? ` / €${target.toLocaleString("he")}` : ""}
              </span>
            </div>
            <div className="mt-2 flex gap-4 text-[12px] text-[var(--text-3)]">
              <span>כניסות: {eur(est.entriesTotal)}</span>
              <span>אוכל ותחבורה: {eur(est.allowanceTotal)}</span>
            </div>
            {target != null && (
              <p className="mt-2 text-[12px]" style={{ color: over ? "var(--amber)" : "#0d9488" }}>
                {over
                  ? `מעל התקציב בכ-€${(est.avgDaily - target).toLocaleString("he")} ליום`
                  : "בתוך התקציב היומי 👍"}
              </p>
            )}
          </div>

          <div className="flex flex-col">
            {est.perDay.map((d, i) => (
              <div key={i} className="flex items-center justify-between border-b border-[var(--border)] py-1.5 text-[12.5px]">
                <span className="text-[var(--text-2)]">{d.label}</span>
                <span className="text-[var(--text-3)]">
                  כניסות {eur(d.entries)} · סה״כ <span className="font-medium text-[var(--text)]">{eur(d.total)}</span>
                </span>
              </div>
            ))}
          </div>

          <p className="text-[11.5px] leading-relaxed text-[var(--text-3)]">
            הערכה גסה — מבוססת על רמת-המחיר של כל אטרקציה (לא מחיר מדויק) ואומדן יומי לאוכל ותחבורה מקומית לפי סגנון התקציב. לא כולל טיסות ולינה.
          </p>
        </>
      )}
    </div>
  );
}
