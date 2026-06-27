"use client";

import { useState } from "react";
import { useHotels, type Hotel } from "@/lib/store";
import { BedDouble, Plus, Trash2, MapPin, Loader2, X } from "lucide-react";

export function Hotels() {
  const { hotels, add, remove, loaded } = useHotels();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    // Geocode the address when given (a made-up hotel name pollutes the query);
    // fall back to the name only if no address was entered.
    const q = (address || name).trim();
    if (!q) { setErr("הזינו שם או כתובת"); return; }
    setBusy(true);
    setErr(null);
    try {
      const reqUrl = `/api/geocode?q=${encodeURIComponent(q)}`;
      const res = await fetch(reqUrl);
      if (!res.ok) {
        setErr(`אבחון: סטטוס ${res.status} · ${new URL(reqUrl, location.href).href}`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data) {
        setErr("אבחון: התשובה אינה JSON תקין");
        return;
      }
      if (!data.found) {
        setErr("לא מצאנו את הכתובת — נסו לדייק (עיר, רחוב)");
        return;
      }
      const hotel: Hotel = {
        id: crypto.randomUUID(),
        name: name || data.city || "מלון",
        label: data.label,
        city: data.city,
        country: data.country,
        lat: data.lat,
        lng: data.lng,
        checkIn: checkIn || undefined,
        checkOut: checkOut || undefined,
      };
      add(hotel);
      setName(""); setAddress(""); setCheckIn(""); setCheckOut("");
      setOpen(false);
    } catch (e) {
      setErr(`אבחון: ${(e as Error)?.name || ""} ${(e as Error)?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rise rise-1 mt-8">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[17px] font-bold">המלונות שלי</h2>
        {!open && (
          <button onClick={() => setOpen(true)}
            className="flex items-center gap-1 text-[13px] text-[var(--brand-ink)]">
            <Plus size={15} /> הוסף מלון
          </button>
        )}
      </div>
      <p className="mb-3 text-[13px] text-[var(--text-2)]">
        מלונות שכבר הזמנתם — נבנה סביבם טיול כוכב.
      </p>

      {open && (
        <div className="mb-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[14px] font-medium">מלון חדש</span>
            <button onClick={() => { setOpen(false); setErr(null); }} aria-label="סגור"
              className="text-[var(--text-3)]"><X size={18} /></button>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="שם המלון (לא חובה)"
            className="mb-2 w-full rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-[14px] outline-none" />
          <input value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="כתובת / עיר (למשל: Getreidegasse 9, Salzburg)"
            className="mb-2 w-full rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-[14px] outline-none" />
          <div className="mb-3 flex gap-2">
            <label className="flex-1 text-[12px] text-[var(--text-3)]">
              צ׳ק-אין
              <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[var(--surface-2)] px-2 py-2 text-[13px] text-[var(--text)] outline-none" />
            </label>
            <label className="flex-1 text-[12px] text-[var(--text-3)]">
              צ׳ק-אאוט
              <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[var(--surface-2)] px-2 py-2 text-[13px] text-[var(--text)] outline-none" />
            </label>
          </div>
          {err && <p className="mb-2 text-[12.5px] text-[var(--amber)]">{err}</p>}
          <button onClick={save} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-2.5 text-[14px] font-medium text-white disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
            {busy ? "מאתר…" : "הוסף ואתר במפה"}
          </button>
        </div>
      )}

      {loaded && hotels.length === 0 && !open && (
        <button onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] py-5 text-[14px] font-medium text-[var(--text-2)]">
          <Plus size={18} /> הוסיפו מלון שהזמנתם
        </button>
      )}

      <div className="flex flex-col gap-2.5">
        {hotels.map((h) => (
          <div key={h.id}
            className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]">
            <div className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--brand-soft)] text-[var(--brand-ink)]">
              <BedDouble size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{h.name}</p>
              <p className="truncate text-[12.5px] text-[var(--text-2)]">
                {h.city ? `${h.city}${h.country ? ", " + h.country : ""}` : h.label}
              </p>
              {(h.checkIn || h.checkOut) && (
                <p className="mt-0.5 text-[12px] text-[var(--text-3)]">
                  {h.checkIn} {h.checkOut && `← ${h.checkOut}`}
                </p>
              )}
            </div>
            <button onClick={() => remove(h.id)} aria-label="מחק"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--text-3)]">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
