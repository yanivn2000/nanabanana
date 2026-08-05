"use client";

// OWNER view: every user's trips. Answers "what are people actually building?" —
// which cities, how many days, did the build finish (stops > 0), and who came
// back to edit. Most accounts are GUESTS: Supabase issues an anonymous account to
// every browser so trips persist and sync without a signup, so there is no email
// to show — only a short account key. The "לפי משתמש" view exists because that
// key alone says nothing; grouped, it tells you how many real people there are,
// when they arrived and how much they built.
import { useEffect, useState } from "react";
import { Search, RefreshCw, User, Users, Eye, X } from "lucide-react";
import type { AdminTrip, AdminTripUser } from "@/lib/db";
import type { Itinerary } from "@/lib/trip-types";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
const fmtWhen = (s: string | null) =>
  s ? new Date(s).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
// A guest has no email — show a short, stable account key so their trips can be
// grouped, while being explicit that this is an un-registered visitor.
const userLabel = (u: { email: string | null; user_id: string }) =>
  u.email || `אורח · ${u.user_id.slice(0, 6)}`;

export function TripsTable() {
  const [trips, setTrips] = useState<AdminTrip[] | null>(null);
  const [users, setUsers] = useState<AdminTripUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"trips" | "users">("users");
  // The trip the admin opened to read (full stored object, fetched on demand —
  // the list stays light and no itinerary travels until it's actually wanted).
  const [open, setOpen] = useState<{ t: AdminTrip; data: { itinerary?: Itinerary } | null } | null>(null);

  const openTrip = async (tr: AdminTrip) => {
    setOpen({ t: tr, data: null });
    try {
      const r = await fetch(`/api/admin/trips?user=${encodeURIComponent(tr.user_id)}&trip=${encodeURIComponent(tr.client_id)}`, { cache: "no-store" });
      const j = await r.json();
      setOpen({ t: tr, data: j.trip ?? null });
    } catch { setOpen({ t: tr, data: null }); }
  };

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/trips", { cache: "no-store" });
      if (!r.ok) { setErr(r.status === 403 ? "forbidden" : "error"); setTrips([]); return; }
      const j = await r.json();
      setErr(null); setTrips(j.trips ?? []); setUsers(j.users ?? []);
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
  const userRows = term
    ? users.filter((u) => [u.email, u.user_id, u.cities].some((v) => v?.toLowerCase().includes(term)))
    : users;

  const guests = users.filter((u) => !u.email).length;
  const built = trips.filter((t) => t.stop_count > 0).length;
  const byCity = new Map<string, number>();
  for (const t of trips) byCity.set(t.city_he || t.city || "—", (byCity.get(t.city_he || t.city || "—") ?? 0) + 1);
  const topCities = [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <section className="flex flex-col gap-3">
      {/* headline numbers */}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="rounded bg-[var(--surface-2)] px-2 py-1">{trips.length} טיולים</span>
        <span className="rounded bg-[var(--surface-2)] px-2 py-1">{users.length} משתמשים</span>
        <span className="rounded bg-[var(--amber-soft)] px-2 py-1" title="נכנסו ובנו בלי להירשם — הטיולים שלהם קשורים לדפדפן הזה בלבד">
          {guests} אורחים (לא רשומים)
        </span>
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

      <div className="flex flex-wrap items-center gap-2">
        {/* view switch — people first, because a bare account id means nothing */}
        <div className="flex overflow-hidden rounded-full border border-[var(--border)] text-[12.5px]">
          {([["users", "לפי משתמש", Users], ["trips", "כל הטיולים", User]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setView(k)}
              className="flex items-center gap-1 px-3 py-1.5 transition"
              style={{ background: view === k ? "var(--brand)" : "transparent", color: view === k ? "#fff" : "var(--text-2)" }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <Search size={16} className="text-[var(--text-3)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי עיר, כותרת או משתמש…"
            className="w-full bg-transparent text-[14px] outline-none" />
        </div>
      </div>

      {view === "users" ? (
        <div className="flex flex-col gap-1.5">
          {userRows.length === 0 && <p className="py-8 text-center text-[14px] text-[var(--text-3)]">לא נמצאו משתמשים.</p>}
          {userRows.map((u) => (
            <div key={u.user_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[13px]">
              <span className="flex w-52 shrink-0 items-center gap-1.5 truncate font-semibold" title={u.user_id}>
                {u.email
                  ? <span className="truncate">{u.email}</span>
                  : <><span className="rounded bg-[var(--amber-soft)] px-1.5 py-0.5 text-[11.5px] font-normal">אורח</span>
                      <span className="font-mono text-[12px] text-[var(--text-3)]">{u.user_id.slice(0, 6)}</span></>}
              </span>
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">{u.trips} טיולים</span>
              <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[var(--brand-ink)]">{u.built} בנויים</span>
              <span className="truncate text-[12.5px] text-[var(--text-2)]" title={u.cities ?? ""}>{u.cities || "—"}</span>
              <span className="ms-auto shrink-0 text-[12px] text-[var(--text-3)]">
                הצטרף {fmtDate(u.signed_up)} · אחרון {fmtDate(u.last_trip)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.length === 0 && <p className="py-8 text-center text-[14px] text-[var(--text-3)]">לא נמצאו טיולים.</p>}
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
                {userLabel(t)}
              </span>
              {/* coarse origin — only on trips built since we started recording it */}
              {(t.origin_country || t.device) && (
                <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11.5px] text-[var(--text-3)]"
                  title="מדינה ומכשיר — נתונים לא-אישיים (ללא כתובת IP)">
                  {t.origin_country ?? "??"} · {t.device === "mobile" ? "📱" : "🖥"}
                </span>
              )}
              <span className="ms-auto shrink-0 text-[12px] text-[var(--text-3)]"
                title={`נוצר ${fmtDate(t.created_at)}`}>
                עודכן {fmtWhen(t.updated_at)}
              </span>
              <button onClick={() => openTrip(t)} title="צפייה ביומן המסע"
                className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1 text-[12px] transition hover:border-[var(--brand)]">
                <Eye size={13} /> צפה
              </button>
            </div>
          ))}
        </div>
      )}

      {/* read-only viewer — the itinerary exactly as the traveller has it */}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-[var(--radius)] bg-[var(--surface)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="serif text-[19px] font-bold">{open.t.title || "ללא כותרת"}</h3>
                <p className="text-[13px] text-[var(--text-2)]">
                  {[open.t.city_he || open.t.city, open.t.days ? `${open.t.days} ימים` : null,
                    open.t.email || `אורח · ${open.t.user_id.slice(0, 6)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button onClick={() => setOpen(null)} className="rounded-full p-1 hover:bg-[var(--surface-2)]" aria-label="סגירה">
                <X size={18} />
              </button>
            </div>
            {!open.data && <p className="py-6 text-center text-[14px] text-[var(--text-3)]">טוען…</p>}
            {open.data && !open.data.itinerary?.days?.length &&
              <p className="py-6 text-center text-[14px] text-[var(--text-3)]">לטיול הזה אין יומן בנוי.</p>}
            {open.data?.itinerary?.days?.map((d, i) => (
              <div key={i} className="mb-3 rounded-[var(--radius-sm)] border border-[var(--border)] p-2.5">
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold">{d.label || `יום ${i + 1}`}</span>
                  {d.dayTrip && <span className="rounded bg-[var(--amber-soft)] px-1.5 py-0.5 text-[11.5px]">🚗 יום טיול</span>}
                  <span className="text-[12px] text-[var(--text-3)]">{d.stops?.length ?? 0} עצירות</span>
                </div>
                <ol className="flex flex-col gap-1">
                  {d.stops?.map((s, j) => (
                    <li key={j} className="flex items-baseline gap-2 text-[13px]">
                      <span className="w-11 shrink-0 font-mono text-[12px] text-[var(--text-3)]">{s.time || "—"}</span>
                      <span className={s.kind === "food" && !s.id ? "text-[var(--text-3)]" : ""}>{s.name}</span>
                      {s.duration && <span className="text-[12px] text-[var(--text-3)]">· {s.duration}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
