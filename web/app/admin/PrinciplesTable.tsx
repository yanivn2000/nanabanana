"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2, Plus, ChefHat } from "lucide-react";
import type { AdminDestination } from "@/lib/db";
import { RULE_KINDS, TYPE_HE, DIM_HE, KIND_GROUP, GROUP_ORDER, GROUP_HELP, principleLabel, type Principle } from "@/lib/brain/rules";

const AUD = [{ v: "", he: "כל הקהלים" }, { v: "families", he: "עם ילדים" }, { v: "adults", he: "בלי ילדים" }];
const TYPE_OPTS = Object.keys(TYPE_HE);
const DIM_OPTS = Object.keys(DIM_HE);

// One editable param field (dropdown / number / text) for a rule.
function ParamField({ field, value, onChange }: { field: { key: string; type: string; label: string }; value: unknown; onChange: (v: unknown) => void }) {
  const cls = "rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[12.5px]";
  if (field.type === "audience")
    return <select className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)}>{AUD.map((a) => <option key={a.v} value={a.v}>{a.he}</option>)}</select>;
  if (field.type === "exptype")
    return <select className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>{TYPE_OPTS.map((t) => <option key={t} value={t}>{TYPE_HE[t]}</option>)}</select>;
  if (field.type === "dimension")
    return <select className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>{DIM_OPTS.map((d) => <option key={d} value={d}>{DIM_HE[d]}</option>)}</select>;
  if (field.type === "number")
    return <input type="number" className={`${cls} w-14 text-center`} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />;
  if (field.type === "time")
    return <input type="time" className={`${cls} w-24 text-center`} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  return <input type="text" className={`${cls} w-64`} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

export function PrinciplesTable({ destinations }: { destinations: AdminDestination[] }) {
  const [items, setItems] = useState<Principle[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftKind, setDraftKind] = useState("");
  const [draftParams, setDraftParams] = useState<Record<string, unknown>>({});

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/principles");
    if (res.ok) setItems((await res.json()).principles ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const patch = async (id: number, body: Record<string, unknown>) => {
    // optimistic local update, then persist
    setItems((s) => s.map((p) => p.id === id ? { ...p, ...body } as Principle : p));
    await fetch("/api/admin/principles", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
  };
  const del = async (id: number) => {
    if (!confirm("למחוק עיקרון?")) return;
    await fetch(`/api/admin/principles?id=${id}`, { method: "DELETE" });
    await load();
  };
  const add = async () => {
    if (!draftKind) return;
    await fetch("/api/admin/principles", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: draftKind, params: draftParams, audience: draftParams.audience ?? null }) });
    setDraftKind(""); setDraftParams({});
    await load();
  };


  const Row = (p: Principle) => (
    <div key={p.id} className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-2 text-[13px]"
      style={{ background: p.enabled ? "var(--surface)" : "var(--surface-2)", opacity: p.enabled ? 1 : 0.55 }}>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => patch(p.id, { enabled: !p.enabled })} title={p.enabled ? "כבה" : "הפעל"}
          className="relative h-4 w-7 shrink-0 rounded-full transition" style={{ background: p.enabled ? "var(--brand)" : "var(--border)" }}>
          <span className="absolute top-0.5 size-3 rounded-full bg-white transition-all" style={{ insetInlineStart: p.enabled ? "14px" : "2px" }} />
        </button>
        <span className="min-w-0 flex-1 font-medium text-[var(--text)]">{principleLabel(p.kind, p.params)}</span>
        {/* inline param editors */}
        <span className="flex items-center gap-1.5">
          {(RULE_KINDS[p.kind]?.params ?? []).map((f) => (
            <ParamField key={f.key} field={f} value={p.params[f.key]}
              onChange={(v) => patch(p.id, { params: { ...p.params, [f.key]: v } })} />
          ))}
        </span>
        {p.source_note_id && <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10.5px] text-[var(--brand-ink)]" title="נולד מהערת-עורך למוח">מהערה</span>}
        {p.city && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-3)]">{p.city}</span>}
        <button onClick={() => del(p.id)} className="shrink-0 text-[var(--text-3)] hover:text-[var(--terra,#c8654a)]"><Trash2 size={13} /></button>
      </div>
      {/* full plain-Hebrew explanation of what the value does */}
      {RULE_KINDS[p.kind]?.help && <p className="pr-9 text-[11.5px] leading-snug text-[var(--text-3)]">{RULE_KINDS[p.kind].help}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12.5px] leading-relaxed text-[var(--text-2)]">
        <div className="mb-1 flex items-center gap-1.5 font-bold text-[var(--text)]"><ChefHat size={15} /> ספר הטכניקות של המוח — "איך מבשלים"</div>
        כללי-בנייה שהמוח מכבד בכל טיול. שקופים ועריכים: הדליקו/כבו, שנו ערכים בתפריטים. המוח קורא את הכללים המדויקים (kind+params), לא טקסט חופשי. כללים שנולדו מהערות-עורך מסומנים <b>מהערה</b>.
      </div>

      {loading ? <Loader2 className="animate-spin text-[var(--text-3)]" /> : (
        <>
          {GROUP_ORDER.map((group) => {
            const rows = items.filter((p) => (KIND_GROUP[p.kind] ?? "הערות") === group);
            if (!rows.length) return null;
            return (
              <div key={group} className="flex flex-col gap-1.5">
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--border)] pb-1">
                  <span className="text-[13.5px] font-bold text-[var(--brand-ink)]">{group}</span>
                  <span className="text-[11.5px] text-[var(--text-3)]">{GROUP_HELP[group]}</span>
                </div>
                {rows.map(Row)}
              </div>
            );
          })}

          {/* add a new principle */}
          {draftKind && RULE_KINDS[draftKind]?.help && (
            <p className="rounded-[var(--radius-sm)] bg-[var(--brand-soft)] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--brand-ink)]">{RULE_KINDS[draftKind].help}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] p-2.5">
            <span className="text-[12.5px] font-medium text-[var(--text-2)]">הוסף טכניקה:</span>
            <select value={draftKind} onChange={(e) => { setDraftKind(e.target.value); setDraftParams({}); }}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[13px]">
              <option value="">בחרו סוג כלל…</option>
              {Object.entries(RULE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
            </select>
            {draftKind && RULE_KINDS[draftKind].params.map((f) => (
              <label key={f.key} className="flex items-center gap-1 text-[12px] text-[var(--text-3)]">{f.label}
                <ParamField field={f} value={draftParams[f.key]} onChange={(v) => setDraftParams((s) => ({ ...s, [f.key]: v }))} /></label>
            ))}
            {draftKind && (
              <>
                <span className="text-[12.5px] text-[var(--text-2)]">→ <b>{principleLabel(draftKind, draftParams)}</b></span>
                <button onClick={add} className="flex items-center gap-1 rounded-full bg-[var(--brand)] px-3 py-1 text-[12.5px] font-medium text-white">
                  <Plus size={13} /> הוסף
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
