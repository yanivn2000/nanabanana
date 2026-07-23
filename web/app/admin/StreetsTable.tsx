"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Check } from "lucide-react";
import type { AdminDestination, Street } from "@/lib/db";

const KIND_HE: Record<string, string> = { street: "🛣️ רחוב", canal: "🚤 תעלה", cluster: "🧩 אשכול" };
type AreaOpt = { id: number; name_he: string | null };

// Admin view of the "recommended streets" layer: a map that draws each street's
// real OSM polyline over the neighbourhood footprints (so a wrong match jumps
// out) + an editable card per street with its best-for tag, neighbourhood link
// and an approve toggle.
export function StreetsTable({ destinations }: { destinations: AdminDestination[] }) {
  const [destId, setDestId] = useState(destinations.find((d) => /amsterdam/i.test(d.city))?.id ?? destinations[0]?.id ?? 0);
  const [rows, setRows] = useState<Street[]>([]);
  const [areas, setAreas] = useState<AreaOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Record<number, Partial<Street>>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/streets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", destination_id: destId }),
      });
      const data = await res.json();
      const r: Street[] = res.ok ? (data.rows ?? []) : [];
      setRows(r); setAreas(res.ok ? (data.areas ?? []) : []);
      const d: Record<number, Partial<Street>> = {};
      for (const s of r) d[s.id] = { name_he: s.name_he, name_en: s.name_en, best_for_he: s.best_for_he, vibe_he: s.vibe_he };
      setDraft(d);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [destId]);

  const set = (id: number, k: keyof Street, v: string) => setDraft((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));

  async function save(id: number, extra?: Partial<Street>) {
    setSaving(id);
    try {
      const d = draft[id] ?? {};
      const fields: Record<string, unknown> = {
        name_he: d.name_he, name_en: d.name_en, best_for_he: d.best_for_he, vibe_he: d.vibe_he, ...extra,
      };
      const res = await fetch("/api/admin/streets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", id, fields }),
      });
      if (res.ok) {
        setRows((s) => s.map((x) => x.id === id ? { ...x, ...fields } as Street : x));
        setSavedId(id); setTimeout(() => setSavedId((v) => (v === id ? null : v)), 1600);
      }
    } finally { setSaving(null); }
  }

  // map projection over all street points + area-less streets' centroids
  const pts = useMemo(() => rows.flatMap((s) => s.geometry?.length ? s.geometry : (s.lat != null ? [[s.lat, s.lng!] as [number, number]] : [])), [rows]);
  const box = useMemo(() => {
    if (!pts.length) return null;
    const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
    return { latMin: Math.min(...lats), latMax: Math.max(...lats), lngMin: Math.min(...lngs), lngMax: Math.max(...lngs) };
  }, [pts]);
  const W = 680, H = 340, PAD = 26;
  const px = (lng: number) => box && box.lngMax > box.lngMin ? PAD + (lng - box.lngMin) / (box.lngMax - box.lngMin) * (W - 2 * PAD) : W / 2;
  const py = (lat: number) => box && box.latMax > box.latMin ? PAD + (box.latMax - lat) / (box.latMax - box.latMin) * (H - 2 * PAD) : H / 2;
  const approvedCount = rows.filter((s) => s.approved).length;

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
          {loading ? <Loader2 size={15} className="inline animate-spin" /> : `${rows.length} רחובות · ${approvedCount} מאושרים`}
        </span>
      </div>

      {!loading && rows.length === 0 && (
        <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] p-6 text-center text-[13.5px] text-[var(--text-3)]">
          אין עדיין רחובות מומלצים לעיר הזו.
        </p>
      )}

      {box && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]">
            <rect x="1" y="1" width={W - 2} height={H - 2} rx="12" fill="var(--surface)" stroke="var(--border)" />
            <text x={W - 12} y="20" textAnchor="end" fontSize="11" fill="var(--text-3)">↑ צפון</text>
            {rows.map((s) => {
              const on = hover === s.id;
              const col = s.approved ? "var(--brand)" : "var(--accent-ink, #c88a3a)";
              if (s.geometry?.length) {
                const dpath = s.geometry.map((p, i) => `${i ? "L" : "M"}${px(p[1]).toFixed(1)},${py(p[0]).toFixed(1)}`).join(" ");
                const mid = s.geometry[Math.floor(s.geometry.length / 2)];
                return (
                  <g key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                    <path d={dpath} fill="none" stroke={col} strokeWidth={on ? 5 : 3} strokeLinecap="round" strokeOpacity={on ? 1 : 0.8} />
                    {on && <text x={px(mid[1])} y={py(mid[0]) - 8} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text)">{s.name_he}</text>}
                  </g>
                );
              }
              if (s.lat == null) return null;
              return <circle key={s.id} cx={px(s.lng!)} cy={py(s.lat)} r={5} fill={col} stroke="#fff" strokeWidth={1.5}
                onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} />;
            })}
          </svg>
          <p className="px-2 pb-1 pt-1 text-[11.5px] text-[var(--text-3)]">
            כל קו = רחוב אמיתי מ-OSM · <span className="text-[var(--brand-ink)]">ירוק = מאושר</span> · כתום = ממתין · העבירו עכבר לשם
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((s) => {
          const d = draft[s.id] ?? {};
          const hasGeo = !!s.geometry?.length;
          return (
            <div key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}
              className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border p-3.5"
              style={{ borderColor: s.approved ? "var(--brand)" : hover === s.id ? "var(--accent-ink)" : "var(--border)", background: "var(--surface)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-full bg-[var(--surface-2)] p-0.5 text-[11px]">
                  {(["street", "canal", "cluster"] as const).map((k) => (
                    <button key={k} onClick={() => save(s.id, { kind: k })} disabled={saving === s.id}
                      className="rounded-full px-2 py-0.5 font-medium transition disabled:opacity-50"
                      style={s.kind === k ? { background: "var(--surface)", color: "var(--brand-ink)", boxShadow: "var(--shadow)" } : { color: "var(--text-3)" }}>
                      {KIND_HE[k]}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                    style={hasGeo ? { background: "var(--brand-soft)", color: "var(--brand-ink)" } : { background: "#f6e0de", color: "#c0453f" }}>
                    {hasGeo ? `🗺️ ${s.geometry!.length} נק׳` : "אין מפה"}
                  </span>
                  <button onClick={() => save(s.id, { approved: !s.approved })} disabled={saving === s.id}
                    className="rounded-full border px-3 py-1 text-[12px] font-bold transition disabled:opacity-50"
                    style={s.approved
                      ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }
                      : { background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" }}>
                    {s.approved ? "✓ מאושר" : "אשר"}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <input value={d.name_he ?? ""} onChange={(e) => set(s.id, "name_he", e.target.value)} placeholder="שם (עברית)"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]" />
                <input value={d.name_en ?? ""} onChange={(e) => set(s.id, "name_en", e.target.value)} placeholder="Name (EN)" dir="ltr"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--text-2)] outline-none focus:border-[var(--brand)]" />
              </div>
              <label className="text-[11.5px] text-[var(--text-3)]">מתאים ל… (best for)
                <input value={d.best_for_he ?? ""} onChange={(e) => set(s.id, "best_for_he", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] font-medium outline-none focus:border-[var(--brand)]" />
              </label>
              <textarea value={d.vibe_he ?? ""} onChange={(e) => set(s.id, "vibe_he", e.target.value)} rows={2} placeholder="אופי הרחוב"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] leading-snug outline-none focus:border-[var(--brand)]" />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-3)]">שכונה
                  <select value={s.area_id ?? ""} onChange={(e) => save(s.id, { area_id: e.target.value ? Number(e.target.value) : null })}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[13px] text-[var(--text)]">
                    <option value="">— ללא שכונה</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name_he}</option>)}
                  </select>
                </label>
                <button onClick={() => save(s.id)} disabled={saving === s.id}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-5 py-1.5 text-[13px] font-medium text-white disabled:opacity-60">
                  {saving === s.id ? <Loader2 size={13} className="animate-spin" /> : savedId === s.id ? <Check size={13} /> : null}
                  {savedId === s.id ? "נשמר" : "שמירה"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
