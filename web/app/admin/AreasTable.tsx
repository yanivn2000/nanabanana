"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Check, MapPin, ChevronDown, Star } from "lucide-react";
import type { AdminDestination, Area, AreaAttraction } from "@/lib/db";

const CAT_HE: Record<string, string> = {
  nature: "טבע", museum: "מוזיאון", attraction: "אטרקציה", historic: "היסטוריה",
  tourism: "תיירות", leisure: "פנאי", sport: "ספורט", food: "אוכל", shopping: "קניות",
};

// Admin view of the neighbourhood/areas layer: a spatial mini-map + an editable
// card per area (name, vibe, "best for", gateway) with an approve toggle. Closes
// the "auto-discovered → you approve" loop.
export function AreasTable({ destinations }: { destinations: AdminDestination[] }) {
  // default to a city that actually has areas (London) if present
  const [destId, setDestId] = useState(destinations.find((d) => /london/i.test(d.city))?.id ?? destinations[0]?.id ?? 0);
  const [rows, setRows] = useState<Area[]>([]);
  const [attractions, setAttractions] = useState<AreaAttraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Record<number, Partial<Area> & { best_for_str?: string }>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [openList, setOpenList] = useState<number | null>(null);

  // attractions grouped by their area
  const byArea = useMemo(() => {
    const m = new Map<number, AreaAttraction[]>();
    for (const a of attractions) { const g = m.get(a.area_id) ?? []; g.push(a); m.set(a.area_id, g); }
    return m;
  }, [attractions]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/areas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", destination_id: destId }),
      });
      const data = await res.json();
      const r: Area[] = res.ok ? (data.rows ?? []) : [];
      setRows(r);
      setAttractions(res.ok ? (data.attractions ?? []) : []);
      const d: Record<number, Partial<Area> & { best_for_str?: string }> = {};
      for (const a of r) d[a.id] = {
        name_he: a.name_he, name_en: a.name_en, vibe_he: a.vibe_he, gateway_he: a.gateway_he,
        best_for_str: (a.best_for ?? []).join(", "),
      };
      setDraft(d);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [destId]);

  const set = (id: number, k: string, v: string) =>
    setDraft((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));

  async function save(id: number, extra?: Partial<Area>) {
    setSaving(id);
    try {
      const d = draft[id] ?? {};
      const fields: Record<string, unknown> = {
        name_he: d.name_he, name_en: d.name_en, vibe_he: d.vibe_he, gateway_he: d.gateway_he,
        best_for: (d.best_for_str ?? "").split(",").map((x) => x.trim()).filter(Boolean),
        ...extra,
      };
      const res = await fetch("/api/admin/areas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", id, fields }),
      });
      if (res.ok) {
        setRows((s) => s.map((x) => x.id === id ? { ...x, ...fields, best_for: fields.best_for as string[] } as Area : x));
        setSavedId(id); setTimeout(() => setSavedId((v) => (v === id ? null : v)), 1800);
      }
    } finally { setSaving(null); }
  }

  // mini-map projection
  const box = useMemo(() => {
    if (!rows.length) return null;
    const lats = rows.map((a) => a.lat), lngs = rows.map((a) => a.lng);
    return { latMin: Math.min(...lats), latMax: Math.max(...lats), lngMin: Math.min(...lngs), lngMax: Math.max(...lngs) };
  }, [rows]);
  const W = 640, H = 300, PAD = 34;
  const px = (lng: number) => box && box.lngMax > box.lngMin ? PAD + (lng - box.lngMin) / (box.lngMax - box.lngMin) * (W - 2 * PAD) : W / 2;
  const py = (lat: number) => box && box.latMax > box.latMin ? PAD + (box.latMax - lat) / (box.latMax - box.latMin) * (H - 2 * PAD) : H / 2;
  const maxC = Math.max(1, ...rows.map((a) => a.attraction_count ?? 0));
  const approvedCount = rows.filter((a) => a.approved).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[13px] text-[var(--text-3)]">עיר
          <select value={destId} onChange={(e) => setDestId(Number(e.target.value))}
            className="ms-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[14px] text-[var(--text)]">
            {destinations.map((d) => <option key={d.id} value={d.id}>{d.city_he || d.city} · {d.country_he || d.country}</option>)}
          </select>
        </label>
        <span className="text-[13px] text-[var(--text-3)]">
          {loading ? <Loader2 size={15} className="inline animate-spin" /> : `${rows.length} אזורים · ${approvedCount} מאושרים`}
        </span>
      </div>

      {!loading && rows.length === 0 && (
        <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] p-6 text-center text-[13.5px] text-[var(--text-3)]">
          אין עדיין שכונות לעיר הזו. (נוצרות בגילוי אוטומטי — לונדון מוכנה.)
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]">
            <rect x="1" y="1" width={W - 2} height={H - 2} rx="12" fill="var(--surface)" stroke="var(--border)" />
            <text x={W - 12} y="20" textAnchor="end" fontSize="11" fill="var(--text-3)">↑ צפון</text>
            {rows.map((a) => {
              const x = px(a.lng), y = py(a.lat), r = 9 + Math.sqrt(a.attraction_count ?? 1) * 3;
              return (
                <g key={a.id}>
                  <circle cx={x} cy={y} r={r} fill={a.approved ? "var(--brand)" : "var(--amber, #c88a3a)"}
                    fillOpacity={0.85} stroke="#fff" strokeWidth={2} />
                  <text x={x} y={y} dy=".35em" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{a.attraction_count}</text>
                  <text x={x} y={y + r + 12} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--text)">{a.name_he}</text>
                </g>
              );
            })}
          </svg>
          <p className="px-2 pb-1 pt-1 text-[11.5px] text-[var(--text-3)]">
            גודל = מספר אתרים · <span className="text-[var(--brand-ink)]">ירוק = מאושר</span> · כתום = ממתין לאישור
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((a) => {
          const d = draft[a.id] ?? {};
          return (
            <div key={a.id} className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border p-3.5"
              style={{ borderColor: a.approved ? "var(--brand)" : "var(--border)", background: "var(--surface)" }}>
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setOpenList((v) => (v === a.id ? null : a.id))}
                  className="flex items-center gap-1 text-[var(--text-3)] transition hover:text-[var(--brand-ink)]">
                  <MapPin size={14} />
                  <span className="text-[12px] font-medium">{(byArea.get(a.id)?.length ?? a.attraction_count)} אתרים</span>
                  <ChevronDown size={13} className={`transition-transform ${openList === a.id ? "rotate-180" : ""}`} />
                </button>
                <button onClick={() => save(a.id, { approved: !a.approved })} disabled={saving === a.id}
                  className="rounded-full border px-3 py-1 text-[12px] font-bold transition disabled:opacity-50"
                  style={a.approved
                    ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }
                    : { background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" }}>
                  {a.approved ? "✓ מאושר" : "אשר אזור"}
                </button>
              </div>
              <div className="flex gap-2">
                <input value={d.name_he ?? ""} onChange={(e) => set(a.id, "name_he", e.target.value)} placeholder="שם (עברית)"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]" />
                <input value={d.name_en ?? ""} onChange={(e) => set(a.id, "name_en", e.target.value)} placeholder="Name (EN)" dir="ltr"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--text-2)] outline-none focus:border-[var(--brand)]" />
              </div>
              <textarea value={d.vibe_he ?? ""} onChange={(e) => set(a.id, "vibe_he", e.target.value)} rows={2} placeholder="אופי האזור"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] leading-snug outline-none focus:border-[var(--brand)]" />
              <label className="text-[11.5px] text-[var(--text-3)]">מתאים ל... (מופרד בפסיקים)
                <input value={d.best_for_str ?? ""} onChange={(e) => set(a.id, "best_for_str", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
              </label>
              <label className="text-[11.5px] text-[var(--text-3)]">רמז הגעה (שער)
                <input value={d.gateway_he ?? ""} onChange={(e) => set(a.id, "gateway_he", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
              </label>
              <div className="flex justify-end">
                <button onClick={() => save(a.id)} disabled={saving === a.id}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-5 py-1.5 text-[13px] font-medium text-white disabled:opacity-60">
                  {saving === a.id ? <Loader2 size={13} className="animate-spin" /> : savedId === a.id ? <Check size={13} /> : null}
                  {savedId === a.id ? "נשמר" : "שמירה"}
                </button>
              </div>

              {openList === a.id && (
                <div className="mt-1 border-t border-[var(--border)] pt-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {(byArea.get(a.id) ?? []).map((at) => (
                      <span key={at.id}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[12px] text-[var(--text-2)]">
                        {at.must_see === 1 && <Star size={10} className="text-[var(--accent-ink)]" fill="currentColor" />}
                        {at.name_he || at.name_en}
                        <span className="text-[10.5px] text-[var(--text-3)]">· {CAT_HE[at.category] ?? at.category}</span>
                      </span>
                    ))}
                    {!(byArea.get(a.id)?.length) && <span className="text-[12px] text-[var(--text-3)]">אין אתרים מתויגים.</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
