"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, Check, ExternalLink } from "lucide-react";
import { InsightsIngest } from "./InsightsIngest";
import { AttractionsTable } from "./AttractionsTable";
import { AreasTable } from "./AreasTable";
import { GraphTable } from "./GraphTable";
import { BrainEval } from "./BrainEval";
import { Moderation } from "./Moderation";
import type { AdminDestination, Feedback } from "@/lib/db";

const TABS = [
  { key: "cities", label: "🏙️ ערים" },
  { key: "attractions", label: "📊 אטרקציות" },
  { key: "areas", label: "🗺️ שכונות" },
  { key: "graph", label: "🌉 גרף מרחקים" },
  { key: "brain", label: "🧠 המוח" },
  { key: "insights", label: "📥 תובנות" },
  { key: "moderation", label: "🚩 מודרציה" },
  { key: "feedback", label: "💬 פידבק" },
  { key: "posters", label: "🖼️ פוסטרים" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const KIND_HE: Record<string, string> = { bug: "🐞 באג", idea: "💡 רעיון", other: "💬 אחר" };

// Transit-sync recency badge: green if fresh (<90d), amber if stale, grey if the
// city's transit bridges were never synced — so it's clear which cities are due.
function TransitSync({ at }: { at: string | null }) {
  const days = at ? Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000) : null;
  const stale = days == null || days > 90;
  const label = at
    ? `🚇 סונכרן ${new Date(at).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "2-digit" })}`
    : "🚇 לא סונכרן";
  return (
    <span className="rounded px-1.5 py-0.5"
      style={{ background: stale ? "var(--amber-soft)" : "var(--brand-soft)",
               color: stale ? undefined : "var(--brand-ink)" }}
      title={at ? `תחבורה ציבורית סונכרנה לפני ${days} ימים${days! > 90 ? " — כדאי לסנכרן שוב" : ""}` : "התחבורה הציבורית של העיר טרם סונכרנה"}>
      {label}
    </span>
  );
}

// Editable field spec for the city editor (order = display order).
const FIELDS: { key: string; label: string; type: "text" | "number" | "textarea" | "select"; dir?: "ltr"; options?: { value: string; label: string }[]; hint?: string }[] = [
  { key: "city_he", label: "עיר (עברית)", type: "text" },
  { key: "city", label: "City (EN)", type: "text", dir: "ltr" },
  { key: "country_he", label: "מדינה (עברית)", type: "text" },
  { key: "country", label: "Country (EN)", type: "text", dir: "ltr" },
  { key: "region", label: "אזור", type: "text" },
  { key: "israeli_popularity_score", label: "פופולריות ישראלית (1-10)", type: "number" },
  { key: "mobility", label: "סוג ניידות", type: "select",
    options: [{ value: "metro", label: "🚇 מטרו (הליכה/תחב״צ)" }, { value: "car_base", label: "🚗 עיר-בסיס (טיול רכב)" }] },
  { key: "ingest_radius_km", label: "רדיוס קליטה (ק״מ)", type: "number",
    hint: "מטרו ~25 · עיר-בסיס 60-120. אחרי שינוי — בקשו לקלוט מחדש." },
  { key: "lat", label: "Lat", type: "number", dir: "ltr" },
  { key: "lng", label: "Lng", type: "number", dir: "ltr" },
  { key: "timezone", label: "אזור זמן", type: "text", dir: "ltr" },
  { key: "currency", label: "מטבע", type: "text", dir: "ltr" },
  { key: "language", label: "שפה", type: "text" },
  { key: "description_he", label: "תיאור (עברית)", type: "textarea" },
];

function CityRow({ d }: { d: AdminDestination }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String((d as unknown as Record<string, unknown>)[f.key] ?? "")])));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    setState("saving");
    const fields: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const raw = form[f.key].trim();
      fields[f.key] = raw === "" ? null : f.type === "number" ? Number(raw) : raw;
    }
    try {
      const res = await fetch("/api/admin/destinations", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, fields }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("saved");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
      {/* summary row */}
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 p-3 text-right">
        <ChevronDown size={16} className={`shrink-0 text-[var(--text-3)] transition ${open ? "rotate-180" : ""}`} />
        <span className="w-40 shrink-0 truncate text-[15px] font-semibold">{d.city_he || d.city}</span>
        <span className="w-24 shrink-0 truncate text-[13px] text-[var(--text-2)]">{d.country_he || d.country}</span>
        <span className="hidden w-24 shrink-0 text-[12.5px] text-[var(--text-3)] sm:block">{d.region ?? "—"}</span>
        <span className="flex flex-1 flex-wrap justify-end gap-1.5 text-[12px]">
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">{d.shown_count.toLocaleString("he-IL")} מוצגים</span>
          <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[var(--brand-ink)]">⭐ {d.must_count}</span>
          {d.editor_ranked > 0 && <span className="rounded bg-[var(--amber-soft)] px-1.5 py-0.5">✎ {d.editor_ranked} דורגו</span>}
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">🖼 {d.img_pct}%</span>
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">עב׳ {d.he_pct}%</span>
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5" title={`${d.edge_count} גשרי מעבר, מתוכם ${d.transit_edge_count} עם תחבורה ציבורית`}>
            🌉 {d.edge_count}
          </span>
          <span className="rounded px-1.5 py-0.5" title={d.mobility === "car_base" ? "עיר-בסיס לטיול רכב" : "עיר מטרו (הליכה/תחב״צ)"}
            style={d.mobility === "car_base"
              ? { background: "var(--amber-soft)", color: "var(--text)" }
              : { background: "var(--surface-2)", color: "var(--text-3)" }}>
            {d.mobility === "car_base" ? "🚗" : "🚇"} {d.ingest_radius_km}ק״מ
          </span>
          <TransitSync at={d.transit_synced_at} />
        </span>
      </button>
      {/* editor */}
      {open && (
        <div className="border-t border-[var(--border)] p-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <label key={f.key} className={`text-[12.5px] text-[var(--text-3)] ${f.type === "textarea" ? "sm:col-span-2 lg:col-span-3" : ""}`}>
                {f.label}
                {f.type === "textarea" ? (
                  <textarea value={form[f.key]} rows={3}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[13.5px] text-[var(--text)] outline-none focus:border-[var(--brand)]" />
                ) : f.type === "select" ? (
                  <select value={form[f.key] || "metro"}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[13.5px] text-[var(--text)] outline-none focus:border-[var(--brand)]">
                    {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input value={form[f.key]} dir={f.dir}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[13.5px] text-[var(--text)] outline-none focus:border-[var(--brand)]" />
                )}
                {f.hint && <span className="mt-0.5 block text-[11px] text-[var(--text-3)]">{f.hint}</span>}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Link href={`/destination/${d.id}`} className="flex items-center gap-1 text-[13px] text-[var(--brand-ink)]">
              <ExternalLink size={13} /> פתחו את דף העיר (עריכת אטרקציות במצב עורך)
            </Link>
            <button onClick={save} disabled={state === "saving"}
              className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-5 py-2 text-[13.5px] font-medium text-white disabled:opacity-60">
              {state === "saving" ? <Loader2 size={14} className="animate-spin" />
                : state === "saved" ? <Check size={14} /> : null}
              {state === "saved" ? "נשמר" : state === "error" ? "שגיאה — נסו שוב" : "שמירה"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminView({ destinations, feedback, email }: {
  destinations: AdminDestination[]; feedback: Feedback[]; email: string;
}) {
  const [tab, setTab] = useState<TabKey>("cities");
  return (
    <main className="mx-auto max-w-6xl px-5 py-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="serif text-[26px] font-bold">ניהול Yalle</h1>
        <span className="text-[12.5px] text-[var(--text-3)]">{email}</span>
      </div>

      {/* tabs */}
      <div className="mb-4 flex gap-1.5 border-b border-[var(--border)] pb-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="rounded-full px-4 py-1.5 text-[14px] font-medium transition"
            style={{ background: tab === t.key ? "var(--brand)" : "var(--surface)",
                     color: tab === t.key ? "#fff" : "var(--text-2)",
                     border: `1px solid ${tab === t.key ? "var(--brand)" : "var(--border)"}` }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cities" && (
        <section className="flex flex-col gap-2">
          <p className="mb-1 text-[13px] text-[var(--text-3)]">
            {destinations.length} ערים · הקישו על עיר לעריכת הפרטים. עריכת אטרקציות (דירוג/ילדים) נעשית בדף העיר במצב עורך.
          </p>
          {destinations.map((d) => <CityRow key={d.id} d={d} />)}
        </section>
      )}

      {tab === "attractions" && (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <AttractionsTable destinations={destinations} />
        </div>
      )}

      {tab === "areas" && (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-3 text-[13px] text-[var(--text-3)]">
            שכונות שהתגלו אוטומטית (k-means על אתרים שווי-ביקור) ותוארו ידנית. ערכו שם/אופי/רמז-הגעה ואשרו — רק אזורים מאושרים ישמשו בבנייה בהמשך.
          </p>
          <AreasTable destinations={destinations} />
        </div>
      )}

      {tab === "graph" && (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-3 text-[13px] text-[var(--text-3)]">
            גרף המרחקים — כמה גשרים נשמרו בקאש מטיולים, ומטריצת זמני הליכה/תחבורה בין האתרים המובילים (מחושבת חיה מהקואורדינטות).
          </p>
          <GraphTable destinations={destinations} />
        </div>
      )}

      {tab === "brain" && (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-3 text-[13px] text-[var(--text-3)]">
            המוח — מנוע-טיולים דטרמיניסטי (ללא AI). בונה טיול למשפחות/זוגות/חברים בכל עיר, מנקד את עצמו, ומציג ביקורת. לכיול, שמירה כמשבצת והערות למוח — פִתחו כל טיול כ״דף טיול״.
          </p>
          <BrainEval destinations={destinations} />
        </div>
      )}

      {tab === "insights" && (
        <section>
          <p className="mb-3 text-[13px] text-[var(--text-3)]">
            קליטת המלצות מטיילים אמיתיים לשכבת הידע — הדביקו פוסט או גררו קובץ, Claude מזקק תובנות, אתם מאשרים.
          </p>
          <InsightsIngest destinations={destinations} />
        </section>
      )}

      {tab === "moderation" && <Moderation />}

      {tab === "feedback" && (
        <section className="flex flex-col gap-2">
          {feedback.length === 0 && <p className="py-8 text-center text-[14px] text-[var(--text-3)]">אין פידבק עדיין.</p>}
          {feedback.map((f) => (
            <div key={f.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--text-3)]">
                <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">{KIND_HE[f.kind ?? ""] ?? f.kind}</span>
                <span dir="ltr">{new Date(f.created_at).toLocaleString("he-IL")}</span>
                {f.page && <span dir="ltr" className="truncate">{f.page}</span>}
                {f.email && <a href={`mailto:${f.email}`} dir="ltr" className="text-[var(--brand-ink)]">{f.email}</a>}
              </div>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{f.message}</p>
            </div>
          ))}
        </section>
      )}

      {tab === "posters" && (
        <section className="py-6 text-center">
          <p className="mb-1 text-[14.5px] text-[var(--text-2)]">בחירת תמונות פוסטר לערים נמצאת בכלי ייעודי.</p>
          <p className="mb-3 text-[13px] text-[var(--text-3)]">תמונה שבוחרים שם עולה לאתר אוטומטית (עד שעה בגלל קאש) — אין צורך בשלב נוסף.</p>
          <Link href="/admin/posters" className="inline-block rounded-full bg-[var(--brand)] px-6 py-2.5 text-[14.5px] font-medium text-white">
            פתחו את בוחר הפוסטרים
          </Link>
        </section>
      )}
    </main>
  );
}
