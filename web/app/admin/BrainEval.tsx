"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Download, ThumbsUp, ThumbsDown, Map as MapIcon, Save, Trash2, Blocks } from "lucide-react";
import type { AdminDestination } from "@/lib/db";
import type { Itinerary } from "@/lib/trip-types";
import { useTrips } from "@/lib/store";

// Israeli travel sources that ground the Salzburg region module (masa.co.il).
const SALZBURG_SOURCES = [
  "https://www.masa.co.il/article/טיול-בזלצבורג-והסביבה-כמה-ירוק-ככה-מתו/",
  "https://www.masa.co.il/article/זלצבורג-עשרת-הגדולים/",
  "https://www.masa.co.il/article/חבל-טירול-וזלצבורג-עם-ילדים/",
];
type Module = {
  id: string; region: string | null; title_he: string; audience: string | null;
  days: number; city: string | null; city_he: string | null; approved: boolean; source_urls: string[];
};

type Trip = {
  cityId: number; city: string; cityEn: string; country: string;
  audience: "families" | "couples" | "friends"; days: number;
  score: number; needsWork: boolean; stops: number;
  dims: Record<string, number>;
  issues: { dim: string; severity: "critical" | "warn"; msg: string; day?: number }[];
  itinerary: Itinerary;
  daysNames: { name: string; must: boolean; cat: string }[][];
};
type Report = { summary: { version: string; trips: number; avgScore: number; needWork: number }; report: Trip[] };
type Feedback = { verdict?: "good" | "bad"; notes?: string };

const AUD_HE: Record<string, string> = { families: "👨‍👩‍👧 משפחות", couples: "💑 זוגות", friends: "🎉 חברים" };
const DIM_HE: Record<string, string> = {
  walkability: "הליכתיות", mustSee: "כיסוי חובה", audienceFit: "התאמת קהל", variety: "גיוון",
  pace: "קצב", balance: "איזון", coherence: "קוהרנטיות",
};
const scoreColor = (n: number) => n >= 80 ? "var(--brand)" : n >= 65 ? "#c88a3a" : "var(--terra, #c8654a)";
const FB_KEY = "nanabanana.brain.feedback.v1";

export function BrainEval({ destinations }: { destinations: AdminDestination[] }) {
  const { create } = useTrips();
  const [days, setDays] = useState(3);
  const [allCities, setAllCities] = useState(false);
  const [cityId, setCityId] = useState(0); // 0 = default (first 6)
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Report | null>(null);
  const [fb, setFb] = useState<Record<string, Feedback>>({});
  const [modules, setModules] = useState<Module[]>([]);
  const [savingMod, setSavingMod] = useState<string | null>(null);

  const loadModules = async () => {
    const res = await fetch("/api/admin/templates");
    if (res.ok) setModules((await res.json()).templates ?? []);
  };
  useEffect(() => { void loadModules(); }, []);

  // Save this built trip as a reusable, approved regional module ("משבצת") that can
  // later be composed into a multi-city trip. Grounded in the masa sources per city.
  const saveModule = async (t: Trip) => {
    setSavingMod(key(t));
    try {
      const res = await fetch("/api/admin/templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination_id: t.cityId, region: `${t.city} והסביבה`,
          title_he: `${t.city} · ${AUD_HE[t.audience]} · ${t.days} ימים`,
          audience: t.audience, days: t.days, itinerary: t.itinerary, approved: true,
          source_urls: t.cityEn === "Salzburg" ? SALZBURG_SOURCES : [],
        }),
      });
      if (res.ok) await loadModules();
    } finally { setSavingMod(null); }
  };
  const delModule = async (id: string) => {
    if (!confirm("למחוק את המשבצת?")) return;
    const res = await fetch(`/api/admin/templates?id=${id}`, { method: "DELETE" });
    if (res.ok) await loadModules();
  };

  useEffect(() => { try { const r = localStorage.getItem(FB_KEY); if (r) setFb(JSON.parse(r)); } catch {} }, []);
  const saveFb = (next: Record<string, Feedback>) => { setFb(next); try { localStorage.setItem(FB_KEY, JSON.stringify(next)); } catch {} };
  const key = (t: Trip) => `${t.cityId}:${t.audience}`;
  const setVerdict = (t: Trip, v: "good" | "bad") => saveFb({ ...fb, [key(t)]: { ...fb[key(t)], verdict: fb[key(t)]?.verdict === v ? undefined : v } });
  const setNotes = (t: Trip, notes: string) => saveFb({ ...fb, [key(t)]: { ...fb[key(t)], notes } });

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brain-eval", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, cities: allCities ? destinations.map((d) => d.id) : cityId ? [cityId] : undefined }),
      });
      setData(res.ok ? await res.json() : null);
    } finally { setLoading(false); }
  }

  const download = () => {
    if (!data) return;
    const out = {
      brain_version: data.summary.version, days,
      note: "Brain self-eval + editor feedback — hand this to Claude Code to calibrate lib/brain/policy.ts.",
      summary: data.summary,
      // drop the heavy itinerary from the calibration report — keep names + critique.
      trips: data.report.map(({ itinerary, ...t }) => ({ ...t, editor: fb[`${t.cityId}:${t.audience}`] ?? {} })),
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `brain-report-v${data.summary.version}.json`; a.click();
    URL.revokeObjectURL(a.href);
  };

  // Open the Brain's exact trip as a real trip page (map + walking legs + areas) —
  // the only way to judge closeness/flow if you don't know the city by heart.
  const openTrip = (t: Trip) => {
    const trip = create({
      title: `🧠 ${t.city} · ${AUD_HE[t.audience]}`, mode: "preferences",
      city: t.cityEn, cityHe: t.city, country: t.country, destinationId: t.cityId,
      days: t.days, month: new Date().getMonth() + 1, itinerary: t.itinerary, engine: "heuristic",
    });
    window.open(`/trip/${trip.id}`, "_blank");
  };

  const reviewed = useMemo(() => Object.values(fb).filter((f) => f.verdict).length, [fb]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-2)]">ימים
          <input type="number" min={2} max={7} value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-center" /></label>
        <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-2)]">עיר
          <select value={cityId} onChange={(e) => { setCityId(Number(e.target.value)); if (Number(e.target.value)) setAllCities(false); }}
            disabled={allCities}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[13px] disabled:opacity-50">
            <option value={0}>ברירת מחדל (6 ראשונות)</option>
            {destinations.map((d) => <option key={d.id} value={d.id}>{d.city_he || d.city}</option>)}
          </select></label>
        <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-2)]">
          <input type="checkbox" checked={allCities} onChange={(e) => setAllCities(e.target.checked)} /> כל הערים (איטי)</label>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-1.5 text-[13.5px] font-medium text-white disabled:opacity-60">
          {loading ? <Loader2 size={14} className="animate-spin" /> : "🧠"} הרץ בדיקה עצמית
        </button>
        {data && (
          <button onClick={download} className="ms-auto flex items-center gap-1.5 rounded-full border border-[var(--brand)] px-4 py-1.5 text-[13.5px] font-medium text-[var(--brand-ink)]">
            <Download size={14} /> הורד דוח לכיול
          </button>
        )}
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3 text-[13.5px]">
          <span>גרסת מוח <b className="font-mono">{data.summary.version}</b></span>
          <span>· {data.summary.trips} טיולים</span>
          <span>· ניקוד ממוצע <b style={{ color: scoreColor(data.summary.avgScore) }}>{data.summary.avgScore}</b></span>
          <span>· {data.summary.needWork} דורשים שיפור</span>
          <span className="ms-auto text-[var(--text-3)]">סימנת {reviewed}/{data.report.length}</span>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {data?.report.map((t) => {
          const f = fb[key(t)] ?? {};
          return (
            <div key={key(t)} className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border p-3.5"
              style={{ borderColor: f.verdict === "good" ? "var(--brand)" : f.verdict === "bad" ? "var(--terra,#c8654a)" : "var(--border)", background: "var(--surface)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{t.city}</span>
                  <span className="text-[12.5px] text-[var(--text-3)]">{AUD_HE[t.audience]}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => saveModule(t)} disabled={savingMod === key(t)} title="שמור כמשבצת מאושרת לספרייה"
                    className="flex items-center gap-1 rounded-full border border-[var(--accent,#c8654a)] px-2.5 py-1 text-[12px] font-medium text-[var(--accent-ink,#8a3d2a)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50">
                    {savingMod === key(t) ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} משבצת
                  </button>
                  <button onClick={() => openTrip(t)} title="פתח כדף טיול עם מפה"
                    className="flex items-center gap-1 rounded-full border border-[var(--brand)] px-2.5 py-1 text-[12px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-soft)]">
                    <MapIcon size={12} /> דף טיול
                  </button>
                  <span className="grid size-10 place-items-center rounded-full text-[15px] font-bold text-white" style={{ background: scoreColor(t.score) }}>{t.score}</span>
                </div>
              </div>

              {/* dim bars */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {Object.entries(t.dims).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5 text-[11.5px]">
                    <span className="w-16 shrink-0 text-[var(--text-3)]">{DIM_HE[k] ?? k}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div className="h-full rounded-full" style={{ width: `${v}%`, background: scoreColor(v) }} />
                    </div>
                    <span className="w-6 text-end tabular-nums text-[var(--text-3)]">{v}</span>
                  </div>
                ))}
              </div>

              {/* days */}
              <div className="flex flex-col gap-1">
                {t.daysNames.map((d, i) => (
                  <div key={i} className="text-[12px] text-[var(--text-2)]">
                    <span className="text-[var(--text-3)]">יום {i + 1}:</span> {d.map((a) => `${a.must ? "⭐" : ""}${a.name}`).join(" · ")}
                  </div>
                ))}
              </div>

              {/* issues */}
              {t.issues.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {t.issues.map((is, i) => (
                    <li key={i} className="text-[11.5px]" style={{ color: is.severity === "critical" ? "var(--terra,#c8654a)" : "var(--text-3)" }}>
                      {is.severity === "critical" ? "⛔" : "⚠️"} {is.msg}
                    </li>
                  ))}
                </ul>
              )}

              {/* editor verdict + notes */}
              <div className="mt-1 flex items-center gap-2 border-t border-[var(--border)] pt-2">
                <button onClick={() => setVerdict(t, "good")} title="טיול טוב"
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition"
                  style={f.verdict === "good" ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" } : { borderColor: "var(--border)", color: "var(--text-2)" }}>
                  <ThumbsUp size={12} /> טוב
                </button>
                <button onClick={() => setVerdict(t, "bad")} title="דורש שיפור"
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition"
                  style={f.verdict === "bad" ? { background: "var(--terra,#c8654a)", color: "#fff", borderColor: "var(--terra,#c8654a)" } : { borderColor: "var(--border)", color: "var(--text-2)" }}>
                  <ThumbsDown size={12} /> לשיפור
                </button>
              </div>
              <textarea value={f.notes ?? ""} onChange={(e) => setNotes(t, e.target.value)} rows={2}
                placeholder="הערות לעורך: מה טוב, מה לתקן, ולמה…"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--brand)]" />
            </div>
          );
        })}
      </div>

      {!data && !loading && (
        <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] p-6 text-center text-[13.5px] text-[var(--text-3)]">
          המוח יבנה טיול למשפחות/זוגות/חברים בכל עיר, ינקד את עצמו, ויציג את הביקורת. סמנו טוב/לשיפור + הערות, ואז הורידו דוח לכיול.
        </p>
      )}

      {/* Module library ("משבצות"): approved regional blocks to compose into trips */}
      <div className="mt-2 flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
        <div className="flex items-center gap-2">
          <Blocks size={16} className="text-[var(--accent-ink,#8a3d2a)]" />
          <span className="font-bold">ספריית משבצות</span>
          <span className="text-[12.5px] text-[var(--text-3)]">בלוקים אזוריים מאושרים להרכבה בטיול — {modules.length}</span>
        </div>
        {modules.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-3)]">עדיין אין משבצות. הריצו בדיקה, ובכל טיול טוב לחצו “משבצת” כדי לשמור אותו כבלוק מאושר.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {modules.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12.5px]">
                {m.approved && <span className="rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--brand-ink)]">מאושר</span>}
                <span className="font-medium">{m.title_he}</span>
                <span className="text-[var(--text-3)]">· {m.city_he || m.city || m.region} · {m.days} ימים</span>
                {m.source_urls.length > 0 && <span className="text-[11px] text-[var(--text-3)]" title={m.source_urls.join("\n")}>📎 {m.source_urls.length} מקורות</span>}
                <button onClick={() => delModule(m.id)} title="מחק משבצת" className="ms-auto text-[var(--text-3)] transition hover:text-[var(--terra,#c8654a)]">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
