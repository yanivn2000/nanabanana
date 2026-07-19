"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { AdminDestination, GraphStats, GraphAttraction } from "@/lib/db";
import { haversineKm, walkMinutes, estimateLeg } from "@/lib/geo";

// Shared minutes → colour: teal (fast) → terracotta (slow), capped at 90 min.
const CAP = 90;
function colour(m: number): { bg: string; dark: boolean } {
  const t = Math.max(0, Math.min(1, m / CAP));
  const hue = 165 - 150 * t, sat = 42 + 20 * t, light = 90 - 34 * t;
  return { bg: `hsl(${hue} ${sat}% ${light}%)`, dark: light < 66 };
}

export function GraphTable({ destinations }: { destinations: AdminDestination[] }) {
  const [destId, setDestId] = useState(destinations.find((d) => /london/i.test(d.city))?.id ?? destinations[0]?.id ?? 0);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [attractions, setAttractions] = useState<GraphAttraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"walk" | "transit">("walk");
  const [showMatrix, setShowMatrix] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/graph", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination_id: destId }),
      });
      const data = await res.json();
      setStats(res.ok ? data.stats : null);
      setAttractions(res.ok ? (data.attractions ?? []) : []);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [destId]);

  // pairwise walk/transit matrices (deterministic — computed from coords)
  const { walk, transit, avgWalk, avgTransit } = useMemo(() => {
    const n = attractions.length;
    const walk: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const transit: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    let sw = 0, st = 0, c = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const km = haversineKm(attractions[i].lat, attractions[i].lng, attractions[j].lat, attractions[j].lng);
      walk[i][j] = walkMinutes(km);
      transit[i][j] = estimateLeg(attractions[i].lat, attractions[i].lng, attractions[j].lat, attractions[j].lng).transitMin;
      sw += walk[i][j]; st += transit[i][j]; c++;
    }
    return { walk, transit, avgWalk: c ? Math.round(sw / c) : 0, avgTransit: c ? Math.round(st / c) : 0 };
  }, [attractions]);

  const M = mode === "walk" ? walk : transit;
  const nm = (a: GraphAttraction) => a.name_he || a.name_en;
  const syncedLabel = stats?.transit_synced_at
    ? new Date(stats.transit_synced_at).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "2-digit" })
    : "לא סונכרן";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[13px] text-[var(--text-3)]">עיר
          <select value={destId} onChange={(e) => setDestId(Number(e.target.value))}
            className="ms-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[14px] text-[var(--text)]">
            {destinations.map((d) => <option key={d.id} value={d.id}>{d.city_he || d.city} · {d.country_he || d.country}</option>)}
          </select>
        </label>
        {loading && <Loader2 size={15} className="animate-spin text-[var(--text-3)]" />}
      </div>

      {/* graph coverage stats */}
      <div className="flex flex-wrap gap-2.5">
        <Stat label="גשרים בקאש 🌉" value={(stats?.edge_count ?? 0).toLocaleString("he-IL")} hint="מרחקי הליכה שנשמרו מטיולים אמיתיים" />
        <Stat label="גשרי תחבורה 🚌" value={(stats?.transit_edge_count ?? 0).toLocaleString("he-IL")} hint="עם קו תחבורה אמיתי (GTFS) — 0 עד שנחבר" />
        <Stat label="סנכרון תחבורה 🚇" value={syncedLabel} />
        <Stat label="הליכה ממוצעת" value={`${avgWalk} דק׳`} hint={`בין ${attractions.length} האתרים המובילים`} accent />
        <Stat label="תחבורה ממוצעת" value={`~${avgTransit} דק׳`} hint="הערכה (11 דק׳ קבוע + מהירות קו)" accent />
      </div>

      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12.5px] leading-relaxed text-[var(--text-2)]">
        <b className="text-[var(--text)]">שקיפות הגרף:</b> "גשרים בקאש" = מרחקי ההליכה שנשמרו בפועל בטבלת <span className="font-mono text-[11.5px]">attraction_edges</span> מטיולים שנבנו (הליכה דטרמיניסטית, נשמרת לתמיד).
        המטריצה למטה מחושבת <b>חיה מהקואורדינטות</b> (haversine להליכה, הערכה לתחבורה) — כך היא זמינה לכל עיר מיד.
      </div>

      <div>
        <button onClick={() => setShowMatrix((v) => !v)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[13.5px] font-medium text-[var(--brand-ink)] transition hover:border-[var(--brand)]">
          {showMatrix ? "הסתר מטריצה" : `הצג מטריצת מרחקים (${attractions.length}×${attractions.length})`}
        </button>
      </div>

      {showMatrix && attractions.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-full bg-[var(--surface-2)] p-1">
              <button onClick={() => setMode("walk")}
                className="rounded-full px-4 py-1.5 text-[13.5px] font-medium transition"
                style={mode === "walk" ? { background: "var(--surface)", color: "var(--brand-ink)", boxShadow: "var(--shadow)" } : { color: "var(--text-2)" }}>🚶 הליכה</button>
              <button onClick={() => setMode("transit")}
                className="rounded-full px-4 py-1.5 text-[13.5px] font-medium transition"
                style={mode === "transit" ? { background: "var(--surface)", color: "var(--brand-ink)", boxShadow: "var(--shadow)" } : { color: "var(--text-2)" }}>🚌 תחבורה</button>
            </div>
            <span className="text-[11.5px] text-[var(--text-3)]">מהיר → איטי · דקות</span>
          </div>
          <div className="max-h-[70vh] overflow-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
            <table className="border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th className="sticky end-0 top-0 z-30 bg-[var(--surface)] p-1 text-[16px]" style={{ minWidth: 180, width: 180 }}>
                    {mode === "walk" ? "🚶" : "🚌"}
                  </th>
                  {attractions.map((_, j) => (
                    <th key={j} className="sticky top-0 z-20 bg-[var(--surface)] text-[10px] font-medium text-[var(--text-3)]"
                      style={{ minWidth: 26, width: 26, height: 30 }}>{j + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attractions.map((a, i) => (
                  <tr key={a.id}>
                    <th className="sticky end-0 z-10 truncate border-b border-[var(--border)] bg-[var(--surface)] px-2 text-start text-[11.5px] font-normal"
                      style={{ minWidth: 180, width: 180, maxWidth: 180 }} title={`${i + 1}. ${nm(a)}`}>
                      <span className="text-[var(--text-3)]">{i + 1}.</span> {a.must_see === 1 && "⭐ "}{nm(a)}
                    </th>
                    {attractions.map((b, j) => {
                      if (i === j) return <td key={j} style={{ background: "#efeae0", minWidth: 26, height: 24 }} />;
                      const v = M[i][j]; const c = colour(v);
                      return (
                        <td key={j} title={`${nm(a)} → ${nm(b)}: ${v} דק׳`}
                          className="text-center text-[10px] tabular-nums"
                          style={{ background: c.bg, color: c.dark ? "#fff" : "#2a2520", minWidth: 26, width: 26, height: 24 }}>{v}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="min-w-[130px] flex-1 rounded-[var(--radius-sm)] border p-2.5"
      style={{ borderColor: accent ? "#bfe0d9" : "var(--border)", background: accent ? "#eaf3f1" : "var(--surface)" }} title={hint}>
      <div className="text-[11.5px] text-[var(--text-3)]">{label}</div>
      <div className="text-[18px] font-bold tabular-nums" style={{ color: accent ? "var(--brand-ink)" : "var(--text)" }}>{value}</div>
    </div>
  );
}
