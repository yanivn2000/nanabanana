"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, Check, ExternalLink } from "lucide-react";
import type { AdminDestination, Feedback } from "@/lib/db";

const TABS = [
  { key: "cities", label: "🏙️ ערים" },
  { key: "feedback", label: "💬 פידבק" },
  { key: "posters", label: "🖼️ פוסטרים" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const KIND_HE: Record<string, string> = { bug: "🐞 באג", idea: "💡 רעיון", other: "💬 אחר" };

// Editable field spec for the city editor (order = display order).
const FIELDS: { key: string; label: string; type: "text" | "number" | "textarea"; dir?: "ltr" }[] = [
  { key: "city_he", label: "עיר (עברית)", type: "text" },
  { key: "city", label: "City (EN)", type: "text", dir: "ltr" },
  { key: "country_he", label: "מדינה (עברית)", type: "text" },
  { key: "country", label: "Country (EN)", type: "text", dir: "ltr" },
  { key: "region", label: "אזור", type: "text" },
  { key: "israeli_popularity_score", label: "פופולריות ישראלית (1-10)", type: "number" },
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
                ) : (
                  <input value={form[f.key]} dir={f.dir}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[13.5px] text-[var(--text)] outline-none focus:border-[var(--brand)]" />
                )}
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
          <p className="mb-3 text-[14.5px] text-[var(--text-2)]">בחירת תמונות פוסטר לערים נמצאת בכלי ייעודי.</p>
          <Link href="/admin/posters" className="inline-block rounded-full bg-[var(--brand)] px-6 py-2.5 text-[14.5px] font-medium text-white">
            פתחו את בוחר הפוסטרים
          </Link>
        </section>
      )}
    </main>
  );
}
