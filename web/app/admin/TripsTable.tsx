"use client";

// OWNER view: every user's trips. Answers "what are people actually building?" —
// which cities, how many days, did the build finish (stops > 0), and who came
// back to edit. Users are mostly anonymous, so we group by a short user key
// rather than pretending we know a person.
import { useEffect, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import type { AdminTrip } from "@/lib/db";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
const fmtWhen = (s: string | null) =>
  s ? new Date(s).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
// A stable, short, non-identifying handle for an anonymous account.
const userKey = (t: AdminTrip) => t.email || `אנונימי · ${t.user_id.slice(0, 6)}`;

export function TripsTable() {
  const [trips, setTrips] = useState<AdminTrip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/trips", { cache: "no-store" });
      if (!r.ok) { setErr(r.status === 403 ? "forbidden" : "error"); setTrips([]); return; }
      const j = await r.json();
      setErr(null); setTrips(j.trips ?? []);
    } catch { setErr("error"); setTrips([]); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  if (trips === null) return <p className="py-8 text-center text-[14px] text-[var(--text-3)]">טוען…</p>;
  if (err === "forbidden")
    return <p className="py-8 text-center text-[14px] text-[var(--text-3)]">
      התצוגה הזו פתוחה לבעלים בלבד — התחברו עם חשבון הבעלים.
    </p>;

  const term = q.trim().toLowerCase();
  const rows = term
    ? trips.filter((t) => [t.title, t.city_he, t.city, t.country, t.email, t.user_id]
        .some((v) => v?.toLowerCase().includes(term)))
    : trips;

  const users = new Set(trips.map((t) => t.user_id)).size;
  const built = trips.filter((t) => t.stop_count > 0).length;
  // Most-built cities — the one number that says where demand actually is.
  const byCity = new Map<string, number>();
  for (const t of trips) {
    const k = t.city_he || t.city || "—";
    byCity.set(k, (byCity.get(k) ?? 0) + 1);
  }
  const topCities = [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <section className="flex flex-col gap-3">
      {/* headline numbers */}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="rounded bg-[var(--surface-2)] px-2 py-1">{trips.length} טיולים</span>
        <span className="rounded bg-[var(--surface-2)] px-2 py-1">{users} משתמשים</span>
        <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-[var(--brand-ink)]">{built} עם יומן בנוי</span>
        <button onClick={load} disabled={busy}
          className="ms-auto flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[12.5px] disabled:opacity-50">
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> רענון
        </button>
      </div>

      {topCities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--text-2)]">
          <span className="text-[var(--text-3)]">הכי נבנות:</span>
          {topCities.map(([c, n]) => (
            <span key={c} className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">{c} · {n}</span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <Search size={16} className="text-[var(--text-3)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי עיר, כותרת או משתמש…"
          className="w-full bg-transparent text-[14px] outline-none" />
      </div>

      {rows.length === 0 && <p className="py-8 text-center text-[14px] text-[var(--text-3)]">לא נמצאו טיולים.</p>}

      <div className="flex flex-col gap-1.5">
        {rows.map((t) => (
          <div key={`${t.user_id}:${t.client_id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[13px]">
            <span className="w-44 shrink-0 truncate font-semibold" title={t.title ?? ""}>
              {t.title || "ללא כותרת"}
            </span>
            <span className="w-28 shrink-0 truncate text-[var(--text-2)]">{t.city_he || t.city || "—"}</span>
            <span className="w-16 shrink-0 text-[var(--text-3)]">{t.days ?? "—"} ימים</span>
            <span className={`rounded px-1.5 py-0.5 ${t.stop_count > 0 ? "bg-[var(--surface-2)]" : "bg-[var(--amber-soft)]"}`}
              title={t.stop_count > 0 ? `${t.day_count} ימים · ${t.stop_count} עצירות` : "נוצר אבל לא נבנה יומן"}>
              {t.stop_count > 0 ? `${t.day_count}/${t.stop_count} עצירות` : "ריק"}
            </span>
            <span className="truncate text-[12px] text-[var(--text-3)]" title={t.user_id}>
              {userKey(t)}
            </span>
            <span className="ms-auto shrink-0 text-[12px] text-[var(--text-3)]"
              title={`נוצר ${fmtDate(t.created_at)}`}>
              עודכן {fmtWhen(t.updated_at)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
