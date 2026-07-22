"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Loader2, ChevronDown } from "lucide-react";
import type { AdminDestination, AdminAttractionRow } from "@/lib/db";
import { bestTimeBucket } from "@/lib/brain/traits";

// "When to arrive" chip — what the day-ordering engine derives from best_time_he/tips.
const TIME_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  morning: { label: "🌅 בוקר", bg: "#fef3c7", fg: "#92400e" },
  evening: { label: "🌆 ערב", bg: "#e0e7ff", fg: "#3730a3" },
  any: { label: "🕒 גמיש", bg: "var(--surface)", fg: "var(--text-3)" },
};
function TimeOfDay({ r }: { r: AdminAttractionRow }) {
  const b = bestTimeBucket(r);
  if (b === "any" && !r.best_time_he) return null;   // nothing to show
  const c = TIME_CHIP[b];
  return (
    <span className="mt-0.5 flex items-center gap-1 text-[11px]" title="מתי להגיע (מזין את סדר היום)">
      <span className="rounded px-1 py-0.5 text-[10px] font-medium" style={{ background: c.bg, color: c.fg }}>{c.label}</span>
      {r.best_time_he && <span className="text-[var(--text-3)]">{r.best_time_he}</span>}
    </span>
  );
}

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
  const [mustSaving, setMustSaving] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggleOpen = (id: number) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // toggle "חובה" via the editor overlay: rank='must' forces must-see, 'maybe'
  // turns it off (keeps the place, just not a must). Effective must_see updates.
  async function toggleMust(r: AdminAttractionRow) {
    const turningOff = r.must_see === 1;
    setMustSaving(r.id);
    try {
      const res = await fetch("/api/editor/pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination_id: destId, attraction_id: r.id, field: "rank",
          value: turningOff ? "maybe" : "must" }),
      });
      if (res.ok) setRows((s) => s.map((x) => x.id === r.id
        ? { ...x, must_see: turningOff ? 0 : 1, editor_rank: turningOff ? "maybe" : "must" } : x));
    } finally { setMustSaving(null); }
  }

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
  // Break worthiness into its parts so the number and the explanation share one
  // source of truth. worthiness = base + travelers + wiki + must-status (0..1).
  const worthParts = (r: AdminAttractionRow) => {
    const ts = r.traveler_count ? Math.log1p(r.traveler_count) / Math.log1p(maxTrav) : 0;
    const curFactor = r.must_see === 1 ? 1 : r.editor_rank === "maybe" ? 0.5 : 0;
    const base = 0.10, travel = 0.28 * ts, wiki = 0.28 * (r.notable ? 1 : 0), status = 0.34 * curFactor;
    return { base, travel, wiki, status, curFactor, ts, total: Math.min(1, base + travel + wiki + status) };
  };
  const worth = (r: AdminAttractionRow) => worthParts(r).total;
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
              <Fragment key={r.id}>
                <tr className="border-b border-[var(--border)] align-middle hover:bg-[var(--surface-2)]">
                  <td className="p-2">
                    <button onClick={() => toggleOpen(r.id)}
                      title="הסבר על הציונים" aria-expanded={open.has(r.id)}
                      className="group flex items-start gap-1.5 text-right">
                      <ChevronDown size={15} className={`mt-0.5 shrink-0 text-[var(--text-3)] transition-transform ${open.has(r.id) ? "rotate-180" : ""}`} />
                      <span>
                        <span className="font-medium text-[var(--text)] group-hover:text-[var(--brand-ink)]">{r.name_he || r.name_en}</span>
                        {r.name_en && r.name_en !== r.name_he && (
                          <span className="ms-1.5 text-[12px] text-[var(--text-3)]" dir="ltr">{r.name_en}</span>
                        )}
                        <span className="block text-[11px] text-[var(--text-3)]">
                          {r.category}{r.audience_fit?.type ? ` · ${TYPE_HE[r.audience_fit.type] ?? r.audience_fit.type}` : ""}{r.notable ? " · 📚" : ""}
                        </span>
                        <TimeOfDay r={r} />
                      </span>
                    </button>
                  </td>
                  <td className="p-2 text-center">
                    <button onClick={() => toggleMust(r)} disabled={mustSaving === r.id}
                      title={r.must_see === 1 ? "לחצו לכבות חובה" : "לחצו לסמן כחובה"}
                      className="rounded-full border px-2 py-0.5 text-[10.5px] font-bold transition disabled:opacity-50"
                      style={r.must_see === 1
                        ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }
                        : { background: "var(--surface)", color: "var(--text-3)", borderColor: "var(--border)" }}>
                      {mustSaving === r.id ? "…" : r.must_see === 1 ? "⭐ חובה" : "סמן חובה"}
                    </button>
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
                {open.has(r.id) && (
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                    <td colSpan={3 + AUD.length * 2} className="p-0">
                      <ScoreExplain r={r} parts={worthParts(r)} maxTrav={maxTrav} bonuses={bonuses[r.id]} consensus={(k) => consensus(r, k)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type WorthParts = { base: number; travel: number; wiki: number; status: number; curFactor: number; ts: number; total: number };

// Expanded row: shows exactly how each audience's consensus was derived —
// worthiness (base + travelers + wiki + must-status) × AI fit + admin bonus —
// plus a plain-Hebrew reason for why the score landed high or low.
function ScoreExplain({ r, parts, maxTrav, bonuses, consensus }: {
  r: AdminAttractionRow; parts: WorthParts; maxTrav: number;
  bonuses?: { families: number; couples: number; friends: number };
  consensus: (k: "families" | "couples" | "friends") => number;
}) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const statusHe = r.must_see === 1 ? "⭐ חובה" : r.editor_rank === "maybe" ? "אולי" : "רגיל";
  // worthiness factor rows (shared across all audiences)
  const factors = [
    { he: "בסיס", val: parts.base, detail: "קבוע לכל מקום" },
    { he: "מטיילים", val: parts.travel, detail: `${r.traveler_count || 0} מטיילים · מקס׳ בעיר ${maxTrav} (סקאלה לוגריתמית)`, weak: parts.ts < 0.25, strong: parts.ts >= 0.6 },
    { he: "ויקי 📚", val: parts.wiki, detail: r.notable ? "מסומן כבעל ערך אנציקלופדי" : "לא מופיע בוויקיפדיה", weak: !r.notable, strong: !!r.notable },
    { he: "סטטוס חובה", val: parts.status, detail: statusHe, weak: parts.curFactor === 0, strong: parts.curFactor === 1 },
  ];
  // dominant reason the worthiness is what it is
  const drags = factors.filter((f) => f.weak).map((f) => f.he.replace(" 📚", ""));
  const lifts = factors.filter((f) => f.strong).map((f) => f.he.replace(" 📚", ""));

  return (
    <div className="flex flex-col gap-3 px-3 py-3.5 text-[12.5px]">
      {/* worthiness */}
      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="font-bold text-[var(--text)]">חשיבות המקום (worthiness)</span>
          <span className="font-mono font-bold text-[var(--brand-ink)]">{pct(parts.total)}</span>
          <span className="text-[var(--text-3)]">— משותפת לכל הקהלים, מכפילה את ה־fit</span>
        </div>
        {/* stacked contribution bar */}
        <div className="mb-2 flex h-2.5 w-full max-w-[560px] overflow-hidden rounded-full bg-[var(--surface)]">
          {factors.map((f, i) => f.val > 0 && (
            <div key={i} style={{ width: pct(f.val), background: ["#c9c4bb", "var(--brand)", "#7aa06f", "#c88a3a"][i] }} title={`${f.he}: ${pct(f.val)}`} />
          ))}
        </div>
        <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          {factors.map((f, i) => (
            <div key={i} className="flex items-baseline gap-1.5">
              <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: ["#c9c4bb", "var(--brand)", "#7aa06f", "#c88a3a"][i] }} />
              <span className="font-medium text-[var(--text)]">{f.he}</span>
              <span className="font-mono text-[var(--brand-ink)]">+{pct(f.val)}</span>
              <span className="text-[11px] text-[var(--text-3)]">{f.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* per-audience derivation */}
      <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-2.5">
        <span className="font-bold text-[var(--text)]">קונצנזוס לכל קהל = fit × חשיבות + בונוס</span>
        {r.audience_fit ? AUD.map((a) => {
          const fit = r.audience_fit?.[a.key] ?? 0;
          const bonus = bonuses?.[a.key] ?? 0;
          const core = Math.round(fit * parts.total);
          return (
            <div key={a.key} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-[12px]">
              <span className="w-24 shrink-0 font-sans text-[var(--text-2)]">{a.he}</span>
              <span className="text-[var(--text-3)]">fit</span><b className="text-[var(--text)]">{fit}</b>
              <span className="text-[var(--text-3)]">× {pct(parts.total)} =</span>
              <b className="text-[var(--text)]">{core}</b>
              {bonus !== 0 && <><span className="text-[var(--text-3)]">{bonus > 0 ? "+" : "−"} בונוס {Math.abs(bonus)} =</span></>}
              <span className="text-[var(--text-3)]">קונצנזוס</span>
              <b className="rounded bg-[var(--surface)] px-1.5 text-[var(--brand-ink)]">{consensus(a.key)}</b>
            </div>
          );
        }) : <span className="text-[var(--text-3)]">המקום עוד לא נוקד ע״י הבינה (אין fit).</span>}
      </div>

      {/* plain-language takeaway */}
      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[12px] leading-relaxed text-[var(--text-2)]">
        <b className="text-[var(--text)]">למה כזה ציון: </b>
        {lifts.length > 0 && <>מחזק — {lifts.join(", ")}. </>}
        {drags.length > 0 && <>מוריד — {drags.join(", ")}. </>}
        {parts.total < 0.35
          ? "החשיבות נמוכה, אז גם מקום עם fit גבוה ידורג נמוך במסלול. כדי להעלות: סמנו חובה, או הוסיפו בונוס אדמין."
          : parts.total >= 0.7
          ? "החשיבות גבוהה — הקונצנזוס נשען בעיקר על ה־fit של כל קהל."
          : "חשיבות בינונית — הקונצנזוס הוא שילוב מאוזן של fit וחוזק התיק."}
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
