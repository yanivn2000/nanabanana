"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { uid, type FamilyProfile } from "@/lib/store";
import { buildPackingList, type PackItem } from "@/lib/packing";

type State = { checked: string[]; removed: string[]; custom: PackItem[] };

// Per-trip packing list: a smart template + the user's checks / removals / additions.
export function PackingList({
  profile, month, days, country, value, onChange,
}: {
  profile: FamilyProfile;
  month?: number;
  days: number;
  country?: string | null;
  value?: State;
  onChange: (s: State) => void;
}) {
  const [newItem, setNewItem] = useState("");
  const checked = new Set(value?.checked ?? []);
  const removed = new Set(value?.removed ?? []);
  const custom = value?.custom ?? [];
  const cur: State = { checked: [...checked], removed: [...removed], custom };

  const sections = buildPackingList(profile, month, days, country)
    .map((s) => ({ ...s, items: s.items.filter((it) => !removed.has(it.id)) }))
    .filter((s) => s.items.length > 0);
  const allVisible = [...sections.flatMap((s) => s.items), ...custom];
  const packed = allVisible.filter((it) => checked.has(it.id)).length;

  const toggle = (id: string) => {
    const c = new Set(checked);
    c.has(id) ? c.delete(id) : c.add(id);
    onChange({ ...cur, checked: [...c] });
  };
  const removeTmpl = (id: string) =>
    onChange({ ...cur, removed: [...removed, id], checked: cur.checked.filter((x) => x !== id) });
  const removeCustom = (id: string) =>
    onChange({ ...cur, custom: custom.filter((c) => c.id !== id), checked: cur.checked.filter((x) => x !== id) });
  const add = () => {
    const label = newItem.trim();
    if (!label) return;
    onChange({ ...cur, custom: [...custom, { id: `c-${uid()}`, label }] });
    setNewItem("");
  };

  function Row({ it, onRemove }: { it: PackItem; onRemove: () => void }) {
    const on = checked.has(it.id);
    return (
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] py-2">
        <button onClick={() => toggle(it.id)} aria-label="ארזתי"
          className="grid size-5 shrink-0 place-items-center rounded-full border transition"
          style={{ background: on ? "var(--brand)" : "transparent",
                   borderColor: on ? "var(--brand)" : "var(--border)" }}>
          {on && <Check size={13} className="text-white" />}
        </button>
        <span className="flex-1 text-[14.5px]"
          style={{ color: on ? "var(--text-3)" : "var(--text)", textDecoration: on ? "line-through" : "none" }}>
          {it.label}
        </span>
        <button onClick={onRemove} aria-label="הסר" className="text-[var(--text-3)]"><X size={14} /></button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13.5px] text-[var(--text-2)]">ארוז {packed}/{allVisible.length}</span>
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div className="h-full rounded-full bg-[var(--brand)]"
            style={{ width: `${allVisible.length ? (packed / allVisible.length) * 100 : 0}%` }} />
        </div>
      </div>

      {sections.map((s) => (
        <div key={s.section} className="mb-3">
          <p className="eyebrow mb-1">{s.section}</p>
          {s.items.map((it) => <Row key={it.id} it={it} onRemove={() => removeTmpl(it.id)} />)}
        </div>
      ))}

      {custom.length > 0 && (
        <div className="mb-3">
          <p className="eyebrow mb-1">שלי</p>
          {custom.map((it) => <Row key={it.id} it={it} onRemove={() => removeCustom(it.id)} />)}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="הוסף פריט…"
          className="flex-1 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[14px] outline-none placeholder:text-[var(--text-3)]" />
        <button onClick={add} className="grid size-9 place-items-center rounded-lg bg-[var(--brand)] text-white"><Plus size={16} /></button>
      </div>
    </div>
  );
}
