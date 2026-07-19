"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { AdminDestination, AdminAttractionRow } from "@/lib/db";

const AUD = [
  { key: "families" as const, he: "👨‍👩‍👧 משפחות" },
  { key: "couples" as const, he: "💑 זוגות" },
  { key: "friends" as const, he: "🎉 חברים" },
];
const TYPE_HE: Record<string, string> = {
  universal: "אוניברסלי", family: "משפחתי", romantic: "רומנטי", social: "חברתי",
  foodie: "קולינרי", cultural: "תרבות", hidden_gem: "פנינה", outdoors: "טבע",
};

// Full transparency: every attraction of a city with its audience scores, the
// signals that drive the consensus, and an editable per-audience admin bonus.
export function AttractionsTable({ destinations }: { destinations: AdminDestination[] }) {
  const [destId, setDestId] = useState(destinations[0]?.id ?? 0);
  const [rows, setRows] = useState<AdminAttractionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bonuses, setBonuses] = useState<Record<number, { families: number; couples: number; friends: number }>>({});
  const [saving, setSaving] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/attractions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", destination_id: destId }),
      });
      const data = await res.json();
      const r: AdminAttractionRow[] = res.ok ? (data.rows ?? []) : [];
      setRows(r);
      const b: Record<number, { families: number; couples: number; friends: number }> = {};
      for (const a of r) b[a.id] = {
        families: a.admin_bonus?.families ?? 0, couples: a.admin_bonus?.couples ?? 0, friends: a.admin_bonus?.friends ?? 0,
      };
      setBonuses(b);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [destId]);

  // per-city max traveller count, for the same worthiness the consumer computes
  const maxTrav = useMemo(() => Math.max(1, ...rows.map((r) => r.traveler_count)), [rows]);
  const worth = (r: AdminAttractionRow) => {
    const ts = r.traveler_count ? Math.log1p(r.traveler_count) / Math.log1p(maxTrav) : 0;
    const cur = r.must_see === 1 ? 1 : r.editor_rank === "maybe" ? 0.5 : 0;
    return Math.min(1, 0.10 + 0.28 * ts + 0.28 * (r.notable ? 1 : 0) + 0.34 * cur);
  };
  const consensus = (r: AdminAttractionRow, k: "families" | "couples" | "friends") =>
    Math.round(100 * worth(r) * ((r.audience_fit?.[k] ?? 0) / 100)) + (bonuses[r.id]?.[k] ?? 0);

  async function saveBonus(id: number) {
    setSaving(id);
    try {
      await fetch("/api/admin/attractions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bonus", attraction_id: id, ...bonuses[id] }),
      });
      setRows((s) => s.map((x) => x.id === id ? { ...x, admin_bonus: { ...bonuses[id] } } : x));
    } finally { setSaving(null); }
  }
  const setB = (id: number, k: "families" | "couples" | "friends", v: number) =>
    setBonuses((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));

  const scored = rows.filter((r) => r.audience_fit).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[13px] text-[var(--text-3)]">עיר
          <select value={destId} onChange={(e) => setDestId(Number(e.target.value))}
            className="ms-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[14px] text-[var(--text)]">
            {destinations.map((d) => <option key={d.id} value={d.id}>{d.city_he || d.city} · {d.country_he || d.country}</option>)}
          </select>
        </label>
        <span className="text-[13px] text-[var(--text-3)]">
          {loading ? <Loader2 size={15} className="inline animate-spin" /> : `${rows.length} מקומות · ${scored} מנוקדים`}
        </span>
      </div>

      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12.5px] leading-relaxed text-[var(--text-2)]">
        <div className="mb-1.5 font-bold text-[var(--text)]">איך קוראים את הטבלה — שני מספרים לכל קהל:</div>
        <ul className="flex flex-col gap-1.5">
          <li>
            <span className="text-[var(--text-3)]">fit</span> (המספר האפור) — <b>ציון ההתאמה של הבינה</b>: עד כמה המקום מתאים לקהל הזה (0-100).
            זהו שיפוט ה־AI, והוא <b>קבוע</b> — משתנה רק כשמריצים מחדש את הדירוג, לא מהבונוס.
          </li>
          <li>
            <span className="font-semibold text-[var(--brand-ink)]">קונצנזוס</span> (המספר המודגש) — <b>ציון הדירוג בפועל</b>, שקובע את הסדר במסלול הקצר:
            <span className="mx-1 rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[11.5px]">fit × worthiness + בונוס</span>.
            <span className="text-[var(--text-3)]"> worthiness = כמה חזק התיק (מטיילים + 📚 ויקי + חובה).</span> לכן מקום מתאים מאוד יכול לדרג נמוך אם הוא פחות מוכר/מגובה.
          </li>
          <li>
            <span className="font-semibold">בונוס אדמין</span> — נקודות +/− שאתם מוסיפים <b>ישירות לקונצנזוס</b> (לא ל־fit), כדי להעלות/להוריד מקום ידנית. נשמר בעזיבת השדה.
          </li>
        </ul>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-[12px] text-[var(--text-3)]">
              <th className="p-2 text-right font-medium">מקום</th>
              <th className="p-2 font-medium">חובה</th>
              <th className="p-2 font-medium">👤</th>
              {AUD.map((a) => (
                <th key={a.key} className="p-2 font-medium" colSpan={2}>{a.he}</th>
              ))}
            </tr>
            <tr className="border-b border-[var(--border)] text-[11px] text-[var(--text-3)]">
              <th /><th /><th />
              {AUD.map((a) => (
                <FragmentHead key={a.key} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] align-middle hover:bg-[var(--surface-2)]">
                <td className="p-2">
                  <div className="font-medium text-[var(--text)]">{r.name_he || r.name_en}</div>
                  <div className="text-[11px] text-[var(--text-3)]">
                    {r.category}{r.audience_fit?.type ? ` · ${TYPE_HE[r.audience_fit.type] ?? r.audience_fit.type}` : ""}{r.notable ? " · 📚" : ""}
                  </div>
                </td>
                <td className="p-2 text-center">
                  {r.must_see === 1 ? <span className="rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[10.5px] font-bold text-white">חובה</span>
                    : r.editor_rank === "no" ? <span className="text-[11px] text-[#c0453f]">רצפה</span>
                    : r.editor_rank === "maybe" ? <span className="text-[11px] text-[var(--text-3)]">אולי</span>
                    : <span className="text-[11px] text-[var(--text-3)]">—</span>}
                </td>
                <td className="p-2 text-center text-[var(--text-2)] tabular-nums">{r.traveler_count || ""}</td>
                {AUD.map((a) => (
                  <FragmentCell key={a.key}
                    fit={r.audience_fit?.[a.key] ?? null}
                    cons={r.audience_fit ? consensus(r, a.key) : null}
                    bonus={bonuses[r.id]?.[a.key] ?? 0}
                    onBonus={(v) => setB(r.id, a.key, v)}
                    onSave={() => saveBonus(r.id)}
                    saving={saving === r.id} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentHead() {
  return (
    <>
      <th className="p-1 font-normal">fit · קונצנזוס</th>
      <th className="p-1 font-normal">בונוס</th>
    </>
  );
}

function FragmentCell({ fit, cons, bonus, onBonus, onSave, saving }: {
  fit: number | null; cons: number | null; bonus: number; onBonus: (v: number) => void; onSave: () => void; saving: boolean;
}) {
  return (
    <>
      <td className="p-1 text-center tabular-nums">
        {fit == null ? <span className="text-[var(--text-3)]">—</span> : (
          <span><span className="text-[var(--text-3)]">{fit}</span> <span className="font-semibold text-[var(--brand-ink)]">{cons}</span></span>
        )}
      </td>
      <td className="p-1 text-center">
        <input type="number" value={bonus || ""} placeholder="0"
          onChange={(e) => onBonus(Number(e.target.value) || 0)} onBlur={onSave}
          disabled={saving}
          className="w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-center text-[12.5px] tabular-nums outline-none focus:border-[var(--brand)]" />
      </td>
    </>
  );
}
