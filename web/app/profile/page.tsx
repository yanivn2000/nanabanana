"use client";

import { useProfile, DEFAULT_PROFILE, type Kid } from "@/lib/store";
import { Minus, Plus, Trash2, Check, Users } from "lucide-react";

const INTERESTS = ["טבע", "אוכל", "תרבות", "קניות", "ספורט", "חופים", "פארקי שעשועים", "היסטוריה"];
const PACES = ["רגוע", "בינוני", "אינטנסיבי"] as const;
const BUDGETS = ["חסכוני", "בינוני", "מפנק"] as const;
const LODGINGS = ["מלון", "אירבנב", "צימר", "מעורב"];

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3.5 py-1.5 text-[13px] transition"
      style={{
        background: on ? "var(--brand)" : "var(--surface)",
        color: on ? "#fff" : "var(--text-2)",
        border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
      }}
    >
      {children}
    </button>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-full bg-[var(--surface-2)] p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className="flex-1 rounded-full py-1.5 text-[13px] transition"
          style={{
            background: value === o ? "var(--surface)" : "transparent",
            color: value === o ? "var(--text)" : "var(--text-2)",
            fontWeight: value === o ? 500 : 400,
            boxShadow: value === o ? "var(--shadow)" : "none",
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export default function ProfilePage() {
  const [p, save, loaded] = useProfile();
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const addKid = () => save({ ...p, kids: [...p.kids, { name: "", age: 6, loves: "" }] });
  const setKid = (i: number, k: Partial<Kid>) =>
    save({ ...p, kids: p.kids.map((kid, idx) => (idx === i ? { ...kid, ...k } : kid)) });
  const delKid = (i: number) => save({ ...p, kids: p.kids.filter((_, idx) => idx !== i) });

  return (
    <main className="mx-auto max-w-[440px] px-5 pb-28 pt-8">
      <header className="rise mb-6 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)]">
          <Users size={20} />
        </div>
        <div>
          <h1 className="text-[22px] font-bold leading-tight">פרופיל המשפחה</h1>
          <p className="text-[13px] text-[var(--text-2)]">נשמר אוטומטית · מתאים כל טיול עתידי</p>
        </div>
      </header>

      {!loaded ? (
        <p className="text-sm text-[var(--text-3)]">טוען…</p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* adults */}
          <section>
            <label className="mb-2 block text-[14px] font-medium">מבוגרים</label>
            <div className="flex w-fit items-center gap-4 rounded-full bg-[var(--surface)] p-1.5 shadow-[var(--shadow)]">
              <button onClick={() => save({ ...p, adults: Math.max(1, p.adults - 1) })}
                className="grid size-9 place-items-center rounded-full bg-[var(--surface-2)]"><Minus size={16} /></button>
              <span className="w-6 text-center text-[16px] font-medium">{p.adults}</span>
              <button onClick={() => save({ ...p, adults: p.adults + 1 })}
                className="grid size-9 place-items-center rounded-full bg-[var(--surface-2)]"><Plus size={16} /></button>
            </div>
          </section>

          {/* kids */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[14px] font-medium">ילדים</label>
              <button onClick={addKid} className="flex items-center gap-1 text-[13px] text-[var(--brand-ink)]">
                <Plus size={15} /> הוסף ילד
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {p.kids.length === 0 && (
                <p className="text-[13px] text-[var(--text-3)]">אין ילדים בפרופיל. הוסיפו כדי שנתאים אטרקציות וקצב.</p>
              )}
              {p.kids.map((k, i) => (
                <div key={i} className="rounded-[var(--radius-card)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
                  <div className="flex items-center gap-2">
                    <input value={k.name} onChange={(e) => setKid(i, { name: e.target.value })}
                      placeholder="שם" className="min-w-0 flex-1 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[14px] outline-none" />
                    <div className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-2 py-1">
                      <span className="text-[12px] text-[var(--text-3)]">גיל</span>
                      <input type="number" min={0} max={18} value={k.age}
                        onChange={(e) => setKid(i, { age: Number(e.target.value) })}
                        className="w-10 bg-transparent text-center text-[14px] outline-none" />
                    </div>
                    <button onClick={() => delKid(i)} className="grid size-9 place-items-center rounded-lg text-[var(--text-3)]"><Trash2 size={16} /></button>
                  </div>
                  <input value={k.loves} onChange={(e) => setKid(i, { loves: e.target.value })}
                    placeholder="מה הוא אוהב? (חיות, מים, רכבות…)"
                    className="mt-2 w-full rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[13px] outline-none" />
                </div>
              ))}
            </div>
          </section>

          {/* interests */}
          <section>
            <label className="mb-2 block text-[14px] font-medium">מה אוהבים</label>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((v) => (
                <Chip key={v} on={p.interests.includes(v)} onClick={() => save({ ...p, interests: toggle(p.interests, v) })}>{v}</Chip>
              ))}
            </div>
          </section>

          {/* dislikes */}
          <section>
            <label className="mb-2 block text-[14px] font-medium">מה פחות</label>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((v) => (
                <Chip key={v} on={p.dislikes.includes(v)} onClick={() => save({ ...p, dislikes: toggle(p.dislikes, v) })}>{v}</Chip>
              ))}
            </div>
          </section>

          {/* pace + budget */}
          <section>
            <label className="mb-2 block text-[14px] font-medium">קצב</label>
            <Seg value={p.pace} options={PACES} onChange={(v) => save({ ...p, pace: v })} />
          </section>
          <section>
            <label className="mb-2 block text-[14px] font-medium">תקציב</label>
            <Seg value={p.budget} options={BUDGETS} onChange={(v) => save({ ...p, budget: v })} />
          </section>

          {/* daily drive */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[14px] font-medium">מרחק נסיעה ביום</label>
              <span className="text-[13px] text-[var(--brand-ink)]">{p.dailyDriveHours} שעות</span>
            </div>
            <input type="range" min={0.5} max={5} step={0.5} value={p.dailyDriveHours}
              onChange={(e) => save({ ...p, dailyDriveHours: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]" />
          </section>

          {/* lodging */}
          <section>
            <label className="mb-2 block text-[14px] font-medium">סגנון לינה</label>
            <div className="flex flex-wrap gap-2">
              {LODGINGS.map((v) => (
                <Chip key={v} on={p.lodging === v} onClick={() => save({ ...p, lodging: v })}>{v}</Chip>
              ))}
            </div>
          </section>

          <div className="flex items-center justify-between rounded-[var(--radius-card)] bg-[var(--brand-soft)] px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] text-[var(--brand-ink)]"><Check size={16} /> נשמר אוטומטית במכשיר</span>
            <button onClick={() => save(DEFAULT_PROFILE)} className="text-[12px] text-[var(--brand-ink)] underline">אפס</button>
          </div>
        </div>
      )}
    </main>
  );
}
