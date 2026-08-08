"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import type { FamilyProfile, Kid } from "@/lib/store";
import { CategoryTile } from "@/components/CategoryTiles";
import { WALK_PREF_KM, WALK_PREF_LABEL_HE, DEFAULT_WALK_PREF } from "@/lib/geo";

const INTERESTS = ["טבע", "אוכל", "תרבות", "קניות", "ספורט", "חופים", "פארקי שעשועים", "ילדים", "היסטוריה",
  "מוזיקה", "חיי לילה", "מחזמר ותיאטרון", "בלט ואופרה", "וינטג'", "יוקרה", "מוזיאונים"];
const PACES = ["רגוע", "בינוני", "אינטנסיבי"] as const;
const BUDGETS = ["חסכוני", "בינוני", "מפנק"] as const;

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-full bg-[var(--surface-2)] p-1">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className="flex-1 rounded-full py-1.5 text-[14px] transition"
          style={{
            background: value === o ? "var(--surface)" : "transparent",
            color: value === o ? "var(--text)" : "var(--text-2)",
            fontWeight: value === o ? 500 : 400,
            boxShadow: value === o ? "var(--shadow)" : "none",
          }}>
          {o}
        </button>
      ))}
    </div>
  );
}

// Reusable family/traveler editor — used for the global profile (/profile)
// and the per-trip traveler profile (trip page).
export function ProfileEditor({ value: p, onChange: save }: {
  value: FamilyProfile;
  onChange: (p: FamilyProfile) => void;
}) {
  // One tri-state preference list (no more separate likes/dislikes):
  // ניטרלי → מעוניין → לא מעוניין → ניטרלי.
  const catState = (v: string): "yes" | "no" | "none" =>
    p.interests.includes(v) ? "yes" : p.dislikes.includes(v) ? "no" : "none";
  const cycleCat = (v: string) => {
    const s = catState(v);
    if (s === "none") save({ ...p, interests: [...p.interests, v], dislikes: p.dislikes.filter((x) => x !== v) });
    else if (s === "yes") save({ ...p, interests: p.interests.filter((x) => x !== v), dislikes: [...p.dislikes, v] });
    else save({ ...p, dislikes: p.dislikes.filter((x) => x !== v) });
  };
  const addKid = () => save({ ...p, kids: [...p.kids, { name: "", age: 6, loves: "" }] });
  const setKid = (i: number, k: Partial<Kid>) =>
    save({ ...p, kids: p.kids.map((kid, idx) => (idx === i ? { ...kid, ...k } : kid)) });
  const delKid = (i: number) => save({ ...p, kids: p.kids.filter((_, idx) => idx !== i) });

  return (
    <div className="flex flex-col gap-6">
      <section>
        <label className="mb-2 block text-[15px] font-medium">מבוגרים</label>
        <div className="flex w-fit items-center gap-4 rounded-full bg-[var(--surface)] p-1.5 shadow-[var(--shadow)]">
          <button onClick={() => save({ ...p, adults: Math.max(1, p.adults - 1) })}
            className="grid size-9 place-items-center rounded-full bg-[var(--surface-2)]"><Minus size={16} /></button>
          <span className="w-6 text-center text-[16px] font-medium">{p.adults}</span>
          <button onClick={() => save({ ...p, adults: p.adults + 1 })}
            className="grid size-9 place-items-center rounded-full bg-[var(--surface-2)]"><Plus size={16} /></button>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-[15px] font-medium">ילדים</label>
          <button onClick={addKid} className="flex items-center gap-1 text-[14px] text-[var(--brand-ink)]">
            <Plus size={15} /> הוסף ילד
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {p.kids.length === 0 && (
            <p className="text-[14px] text-[var(--text-3)]">אין ילדים. הוסיפו כדי שנתאים אטרקציות וקצב.</p>
          )}
          {p.kids.map((k, i) => (
            <div key={i} className="rounded-[var(--radius-card)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
              <div className="flex items-center gap-2">
                <input value={k.name} onChange={(e) => setKid(i, { name: e.target.value })}
                  placeholder="שם" className="min-w-0 flex-1 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[15px] outline-none" />
                <div className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-2 py-1">
                  <span className="text-[13px] text-[var(--text-3)]">גיל</span>
                  <input type="number" min={0} max={18} value={k.age}
                    onChange={(e) => setKid(i, { age: Number(e.target.value) })}
                    className="w-10 bg-transparent text-center text-[15px] outline-none" />
                </div>
                <button onClick={() => delKid(i)} className="grid size-9 place-items-center rounded-lg text-[var(--text-3)]"><Trash2 size={16} /></button>
              </div>
              <input value={k.loves} onChange={(e) => setKid(i, { loves: e.target.value })}
                placeholder="מה הוא אוהב? (חיות, מים, רכבות…)"
                className="mt-2 w-full rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[14px] outline-none" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <label className="mb-1 block text-[15px] font-medium">מה מעניין אתכם?</label>
        <p className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--text-3)]">
          <span>הקישו כדי לעבור בין:</span>
          <span className="inline-flex items-center gap-1">
            <span className="grid size-4 place-items-center rounded-full bg-[var(--brand)] text-[10px] font-bold text-white">✓</span> מעוניין
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="grid size-4 place-items-center rounded-full bg-[var(--text-3)] text-[10px] font-bold text-white">✕</span> לא מעוניין
          </span>
          <span>· ריק = ניטרלי</span>
        </p>
        {/* Single tri-state preference list — category tiles (brand board). */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {INTERESTS.map((v) => (
            <CategoryTile key={v} label={v} state={catState(v)} onClick={() => cycleCat(v)} />
          ))}
        </div>
      </section>

      <section>
        <label className="mb-2 block text-[15px] font-medium">קצב</label>
        <Seg value={p.pace} options={PACES} onChange={(v) => save({ ...p, pace: v })} />
      </section>
      <section>
        <label className="mb-2 block text-[15px] font-medium">תקציב</label>
        {/* Honest label: the deterministic builder does not price a trip, so this
            only tunes wording/AI. Until it shapes the itinerary, do not imply it
            does. (Audit 2026-08-08 — see docs/logic/build-inputs.md.) */}
        <p className="mb-2 text-[12.5px] text-[var(--text-3)]">משמש לניסוח והמלצות — לא משנה את בחירת האטרקציות.</p>
        <Seg value={p.budget} options={BUDGETS} onChange={(v) => save({ ...p, budget: v })} />
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[15px] font-medium">כמה ללכת ברגל בין מקומות</label>
          <span className="text-[14px] text-[var(--brand-ink)]">{WALK_PREF_LABEL_HE[p.walkPref ?? DEFAULT_WALK_PREF]}</span>
        </div>
        <p className="mb-2 text-[13px] text-[var(--text-3)]">
          עד כמה תעדיפו ללכת ברגל לפני שנציע תחבורה ציבורית (עד ~{WALK_PREF_KM[p.walkPref ?? DEFAULT_WALK_PREF]} ק״מ)
        </p>
        <input type="range" min={1} max={5} step={1} value={p.walkPref ?? DEFAULT_WALK_PREF}
          onChange={(e) => save({ ...p, walkPref: Number(e.target.value) })}
          className="w-full accent-[var(--brand)]" />
        <div className="mt-1 flex justify-between px-0.5 text-[11px] text-[var(--text-3)]">
          <span>🚌 פחות</span><span>🚶 יותר</span>
        </div>
      </section>
    </div>
  );
}
