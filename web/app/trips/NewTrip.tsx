"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, BedDouble, MapPin, Loader2, X } from "lucide-react";
import { useTrips, MONTHS_HE } from "@/lib/store";

type Dest = { id: number; city: string; country: string; attraction_count: number };

export function NewTrip({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { create } = useTrips();
  const [mode, setMode] = useState<"preferences" | "hotels">("preferences");
  const [title, setTitle] = useState("");
  const [days, setDays] = useState(5);
  const [month, setMonth] = useState<number | null>(null);
  const [destId, setDestId] = useState<number | null>(null);
  const [dests, setDests] = useState<Dest[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/destinations")
      .then((r) => r.json())
      .then((d) => setDests(d.destinations || []))
      .catch(() => {});
  }, []);

  function go() {
    const dest = dests.find((d) => d.id === destId);
    const autoTitle =
      title.trim() ||
      (mode === "preferences" && dest ? `טיול ל${dest.city}` : "הטיול שלי");
    setCreating(true);
    const trip = create({
      title: autoTitle,
      mode,
      days,
      month: month as number,
      ...(mode === "preferences" && dest
        ? { city: dest.city, country: dest.country, destinationId: dest.id }
        : {}),
    });
    router.push(`/trip/${trip.id}`);
  }

  const canGo =
    month != null &&
    (mode === "hotels" || (mode === "preferences" && destId != null));

  return (
    <div className="mb-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="serif text-[18px]">טיול חדש</span>
        <button onClick={onClose} aria-label="סגור" className="text-[var(--text-3)]"><X size={18} /></button>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="שם הטיול (לא חובה)"
        className="mb-3 w-full rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-[14px] outline-none"
      />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button onClick={() => setMode("preferences")}
          className="rounded-[var(--radius-sm)] border p-3 text-right transition"
          style={{
            borderColor: mode === "preferences" ? "var(--accent)" : "var(--border)",
            background: mode === "preferences" ? "var(--accent-soft)" : "transparent",
          }}>
          <Sparkles size={18} className="mb-1 text-[var(--accent-ink)]" />
          <div className="text-[13.5px] font-medium">בנה לי לפי העדפות</div>
          <div className="text-[12px] text-[var(--text-2)]">בוחרים יעד, ה-AI בונה</div>
        </button>
        <button onClick={() => setMode("hotels")}
          className="rounded-[var(--radius-sm)] border p-3 text-right transition"
          style={{
            borderColor: mode === "hotels" ? "var(--accent)" : "var(--border)",
            background: mode === "hotels" ? "var(--accent-soft)" : "transparent",
          }}>
          <BedDouble size={18} className="mb-1 text-[var(--accent-ink)]" />
          <div className="text-[13.5px] font-medium">כבר הזמנתי מלונות</div>
          <div className="text-[12px] text-[var(--text-2)]">טיול כוכב סביבם</div>
        </button>
      </div>

      {mode === "preferences" && (
        <div className="mb-3">
          <label className="mb-1.5 block text-[13px] text-[var(--text-2)]">יעד</label>
          <div className="flex flex-wrap gap-2">
            {dests.map((d) => (
              <button key={d.id} onClick={() => setDestId(d.id)}
                className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] transition"
                style={{
                  background: destId === d.id ? "var(--accent)" : "var(--surface-2)",
                  color: destId === d.id ? "#fff" : "var(--text-2)",
                }}>
                <MapPin size={13} /> {d.city}
              </button>
            ))}
            {dests.length === 0 && <span className="text-[13px] text-[var(--text-3)]">טוען יעדים…</span>}
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[13px] text-[var(--text-2)]">מספר ימים</label>
          <span className="text-[13px] font-medium text-[var(--accent-ink)]">{days}</span>
        </div>
        <input type="range" min={1} max={14} value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-full accent-[var(--accent)]" />
      </div>

      <div className="mb-4">
        <label className="mb-1.5 block text-[13px] text-[var(--text-2)]">
          מתי? <span className="text-[var(--accent-ink)]">(חשוב — להמלצות לפי עונה)</span>
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {MONTHS_HE.map((m, i) => {
            const on = month === i + 1;
            return (
              <button key={m} onClick={() => setMonth(i + 1)}
                className="rounded-lg py-2 text-[12.5px] transition"
                style={{
                  background: on ? "var(--accent)" : "var(--surface-2)",
                  color: on ? "#fff" : "var(--text-2)",
                  fontWeight: on ? 500 : 400,
                }}>
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <button onClick={go} disabled={!canGo || creating}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] py-3 text-[15px] font-medium text-white disabled:opacity-50">
        {creating ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
        צור טיול
      </button>
    </div>
  );
}
