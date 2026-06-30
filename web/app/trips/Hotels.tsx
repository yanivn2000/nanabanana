"use client";

import { useState } from "react";
import { useHotels, uid, type Hotel, type Segment } from "@/lib/store";
import { BedDouble, Plus, Trash2, MapPin, Loader2, X, Link2 } from "lucide-react";

export function Hotels({
  tripId, onFocus, segments, countryHint,
}: { tripId: string; onFocus?: (h: Hotel) => void; segments?: Segment[]; countryHint?: string }) {
  const { hotels, add, remove, link, assign, loaded } = useHotels();
  const tripHotels = hotels.filter((h) => h.tripId === tripId);
  const unassigned = hotels.filter((h) => !h.tripId);
  const multi = !!segments && segments.length > 1;

  // Best-guess which leg a hotel belongs to, by matching its city/label to a
  // segment's city name (Hebrew or English, either direction).
  const matchSegment = (h: { city?: string; label?: string; name?: string }): string | null => {
    if (!multi) return null;
    const hay = `${h.city ?? ""} ${h.label ?? ""} ${h.name ?? ""}`.toLowerCase();
    const m = segments!.find((s) => {
      const names = [s.cityHe, s.city].filter(Boolean).map((n) => n!.toLowerCase());
      return names.some((n) => n.length > 1 && (hay.includes(n) || n.includes((h.city ?? "").toLowerCase())));
    });
    return m?.id ?? null;
  };
  const segLabel = (id?: string | null) => {
    const s = segments?.find((x) => x.id === id);
    return s ? (s.cityHe || s.city) : null;
  };

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const q = (address || name).trim();
    if (!q) { setErr("הזינו שם או כתובת"); return; }
    setBusy(true);
    setErr(null);
    try {
      const cc = countryHint ? `&cc=${encodeURIComponent(countryHint)}` : "";
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}${cc}`);
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (!data) { setErr("החיפוש נכשל זמנית — נסו שוב בעוד רגע"); return; }
      if (!data.found) { setErr("לא מצאנו את הכתובת — נסו לדייק (עיר, רחוב)"); return; }
      const hotel: Hotel = {
        id: uid(),
        name: name || data.city || "מלון",
        label: data.label,
        city: data.city,
        country: data.country,
        lat: data.lat,
        lng: data.lng,
        checkIn: checkIn || undefined,
        checkOut: checkOut || undefined,
        tripId,
        segmentId: matchSegment({ city: data.city, label: data.label, name }),
      };
      add(hotel);
      setName(""); setAddress(""); setCheckIn(""); setCheckOut("");
      setOpen(false);
    } catch {
      setErr("החיפוש נכשל זמנית — נסו שוב בעוד רגע");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="eyebrow">מלונות הטיול</p>
        {!open && (
          <button onClick={() => setOpen(true)}
            className="flex items-center gap-1 text-[13px] text-[var(--accent-ink)]">
            <Plus size={15} /> הוסף מלון
          </button>
        )}
      </div>

      {open && (
        <div className="mb-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[14px] font-medium">מלון חדש</span>
            <button onClick={() => { setOpen(false); setErr(null); }} aria-label="סגור"
              className="text-[var(--text-3)]"><X size={18} /></button>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם המלון (לא חובה)"
            className="mb-2 w-full rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-[14px] outline-none" />
          <input value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="כתובת / עיר (למשל: Getreidegasse 9, Salzburg)"
            className="mb-2 w-full rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-[14px] outline-none" />
          <div className="mb-3 flex gap-2">
            <label className="flex-1 text-[12px] text-[var(--text-3)]">צ׳ק-אין
              <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[var(--surface-2)] px-2 py-2 text-[13px] text-[var(--text)] outline-none" />
            </label>
            <label className="flex-1 text-[12px] text-[var(--text-3)]">צ׳ק-אאוט
              <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[var(--surface-2)] px-2 py-2 text-[13px] text-[var(--text)] outline-none" />
            </label>
          </div>
          {err && <p className="mb-2 text-[12.5px] text-[var(--amber)]">{err}</p>}
          <button onClick={save} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] py-2.5 text-[14px] font-medium text-white disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
            {busy ? "מאתר…" : "הוסף ואתר במפה"}
          </button>
        </div>
      )}

      {loaded && tripHotels.length === 0 && !open && (
        <button onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] py-4 text-[14px] font-medium text-[var(--text-2)]">
          <Plus size={18} /> הוסיפו את המלון שהזמנתם
        </button>
      )}

      <div className="flex flex-col gap-2.5">
        {tripHotels.map((h) => {
          const canFocus = !!onFocus && h.lat != null && h.lng != null;
          return (
          <div key={h.id}
            className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)]">
            <button onClick={() => canFocus && onFocus!(h)} disabled={!canFocus}
              className={`flex min-w-0 flex-1 items-center gap-3 text-right ${canFocus ? "lg:cursor-pointer" : ""}`}>
              <div className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)]"
                style={{ background: "rgba(13,148,136,.12)", color: "#0d9488" }}>
                <BedDouble size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{h.name}</p>
                <p className="truncate text-[12.5px] text-[var(--text-2)]">
                  {h.city ? `${h.city}${h.country ? ", " + h.country : ""}` : h.label}
                  {(h.checkIn || h.checkOut) ? ` · ${h.checkIn || ""}${h.checkOut ? "→" + h.checkOut : ""}` : ""}
                </p>
                {canFocus && (
                  <span className="mt-0.5 hidden items-center gap-1 text-[11.5px] text-[#0d9488] lg:inline-flex">
                    <MapPin size={11} /> הצג במפה
                  </span>
                )}
              </div>
            </button>
            {multi && (
              <select value={h.segmentId ?? ""} onChange={(e) => assign(h.id, e.target.value || null)}
                title="לאיזה מקטע שייך המלון"
                className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1.5 text-[11.5px] text-[var(--text-2)] outline-none">
                <option value="">— מקטע —</option>
                {segments!.map((s) => (
                  <option key={s.id} value={s.id}>{s.cityHe || s.city}</option>
                ))}
              </select>
            )}
            <button onClick={() => remove(h.id)} aria-label="מחק"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--text-3)]"><Trash2 size={16} /></button>
          </div>
          );
        })}
      </div>

      {unassigned.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-2">מלונות שהוספת — קשר לטיול הזה</p>
          <div className="flex flex-col gap-2">
            {unassigned.map((h) => (
              <button key={h.id} onClick={() => link(h.id, tripId)}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-right text-[13px]">
                <Link2 size={15} className="text-[var(--accent-ink)]" />
                <span className="min-w-0 flex-1 truncate">{h.name} · {h.city}</span>
                <span className="text-[12px] text-[var(--accent-ink)]">קשר</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
