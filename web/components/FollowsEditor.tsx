"use client";

import { useState } from "react";
import { Plus, X, Music, Trophy, CalendarHeart } from "lucide-react";
import type { Follows } from "@/lib/store";

const OBSERVANCES = ["יום האהבה", "גאווה (Pride)", "חג המולד", "האלווין", "ראש השנה", "קרנבל"];

function AddChips({ icon, label, placeholder, items, onChange }: {
  icon: React.ReactNode; label: string; placeholder: string;
  items: string[]; onChange: (v: string[]) => void;
}) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setVal("");
  };
  return (
    <section>
      <label className="mb-2 flex items-center gap-1.5 text-[15px] font-medium">
        <span className="text-[var(--brand-ink)]">{icon}</span> {label}
      </label>
      <div className="mb-2 flex gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[15px] outline-none" />
        <button onClick={add} className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand)] text-white"><Plus size={16} /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 && <p className="text-[13.5px] text-[var(--text-3)]">עוד לא הוספתם.</p>}
        {items.map((it) => (
          <span key={it} className="flex items-center gap-1 rounded-full bg-[var(--brand-soft)] py-1 pl-1.5 pr-3 text-[14px] text-[var(--brand-ink)]">
            {it}
            <button onClick={() => onChange(items.filter((x) => x !== it))} aria-label="הסר"><X size={13} /></button>
          </span>
        ))}
      </div>
    </section>
  );
}

// Who/what you follow → ⭐ boosts in the "what's on" feed during your dates. (#65)
export function FollowsEditor({ value, onChange }: {
  value: Follows; onChange: (f: Follows) => void;
}) {
  const toggleObs = (o: string) =>
    onChange({ ...value, observances: value.observances.includes(o)
      ? value.observances.filter((x) => x !== o) : [...value.observances, o] });

  return (
    <div className="flex flex-col gap-5">
      <AddChips icon={<Music size={16} />} label="אמנים שאתם עוקבים"
        placeholder="למשל: Metallica, Coldplay" items={value.artists}
        onChange={(artists) => onChange({ ...value, artists })} />
      <AddChips icon={<Trophy size={16} />} label="קבוצות ספורט"
        placeholder="למשל: Arsenal, מכבי" items={value.teams}
        onChange={(teams) => onChange({ ...value, teams })} />
      <section>
        <label className="mb-2 flex items-center gap-1.5 text-[15px] font-medium">
          <span className="text-[var(--brand-ink)]"><CalendarHeart size={16} /></span> ימים ואירועים מיוחדים
        </label>
        <div className="flex flex-wrap gap-2">
          {OBSERVANCES.map((o) => {
            const on = value.observances.includes(o);
            return (
              <button key={o} onClick={() => toggleObs(o)}
                className="rounded-full px-3.5 py-1.5 text-[14px] transition"
                style={{ background: on ? "var(--brand)" : "var(--surface)", color: on ? "#fff" : "var(--text-2)",
                         border: `1px solid ${on ? "var(--brand)" : "var(--border)"}` }}>
                {o}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
