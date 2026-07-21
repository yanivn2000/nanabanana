"use client";

import { useEffect, useState } from "react";
import { Save, Brain, Loader2, Check, X } from "lucide-react";
import type { Trip } from "@/lib/store";
import type { Itinerary } from "@/lib/trip-types";

// Editor-only toolbar shown on ANY trip page (the traveller's, one we generated,
// or a saved module). Two actions, per the editor workflow:
//   1. Save the current (calibrated) trip as an approved reusable module.
//   2. Queue a build-POLICY note for the Brain ("no museum after a museum",
//      "A→B too far", "evenings in area X") — digested later into policy.ts.
const SCOPES = [
  { v: "trip", he: "הטיול הזה" },
  { v: "city", he: "העיר הזו" },
  { v: "global", he: "כל הטיולים" },
];

export function EditorTools({ trip, itinerary }: { trip: Trip; itinerary: Itinerary | null }) {
  const [isEditor, setIsEditor] = useState(false);
  const [savingMod, setSavingMod] = useState(false);
  const [savedRef, setSavedRef] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState("city");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    fetch("/api/editor/me").then((r) => r.json()).then((d) => setIsEditor(!!d.editor)).catch(() => {});
  }, []);

  if (!isEditor) return null;

  async function saveModule() {
    if (!itinerary) return;
    setSavingMod(true); setSavedRef(null);
    try {
      const res = await fetch("/api/admin/templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination_id: trip.destinationId ?? null,
          region: trip.cityHe ? `${trip.cityHe} והסביבה` : null,
          title_he: trip.title || `${trip.cityHe || trip.city} · ${trip.days} ימים`,
          days: trip.days, itinerary, approved: true,
        }),
      });
      if (res.ok) { const d = await res.json(); setSavedRef(d.ref ?? null); }
    } finally { setSavingMod(false); }
  }

  async function saveNote() {
    if (!note.trim()) return;
    setNoteState("saving");
    try {
      const res = await fetch("/api/admin/brain-notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination_id: trip.destinationId ?? null, scope, note, trip_ref: trip.title }),
      });
      if (res.ok) { setNoteState("saved"); setNote(""); setTimeout(() => { setNoteState("idle"); setNoteOpen(false); }, 1200); }
      else setNoteState("idle");
    } catch { setNoteState("idle"); }
  }

  return (
    <div className="relative flex items-center gap-2">
      <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-ink,#8a3d2a)] sm:inline">עורך</span>
      <button onClick={saveModule} disabled={savingMod || !itinerary} title="שמור את הטיול הנוכחי כמשבצת מאושרת"
        className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--accent,#c8654a)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent-ink,#8a3d2a)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50">
        {savingMod ? <Loader2 size={14} className="animate-spin" /> : savedRef ? <Check size={14} /> : <Save size={14} />}
        {savedRef ? `נשמר · משבצת #${savedRef}` : "שמור כמשבצת"}
      </button>
      <button onClick={() => setNoteOpen((v) => !v)} title="כתוב הערת מדיניות למוח (איך לבנות טוב יותר)"
        className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[var(--brand)] px-3 py-1.5 text-[13px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-soft)]">
        <Brain size={14} /> הערה למוח
      </button>

      {noteOpen && (
        <div className="absolute end-0 top-[calc(100%+8px)] z-50 w-[340px] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_10px_30px_rgba(0,0,0,.15)]">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[13.5px] font-bold"><Brain size={14} className="text-[var(--brand-ink)]" /> הערה למוח</span>
            <button onClick={() => setNoteOpen(false)} className="text-[var(--text-3)] hover:text-[var(--text)]"><X size={15} /></button>
          </div>
          <p className="mb-2 text-[11.5px] leading-snug text-[var(--text-3)]">
            הנחיית בנייה למוח (לא עובדה על אתר). למשל: ״לא מוזיאון אחרי מוזיאון״, ״המרחק בין א׳ ל-ב׳ גדול מדי״, ״בערב עדיף באזור X״. תיכנס לתור עיכול.
          </p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
            placeholder="מה המוח צריך ללמוד…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-1 text-[12px] text-[var(--text-3)]">חל על
              <select value={scope} onChange={(e) => setScope(e.target.value)}
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-[12px]">
                {SCOPES.map((s) => <option key={s.v} value={s.v}>{s.he}</option>)}
              </select>
            </label>
            <button onClick={saveNote} disabled={noteState === "saving" || !note.trim()}
              className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
              {noteState === "saving" ? <Loader2 size={13} className="animate-spin" /> : noteState === "saved" ? <Check size={13} /> : null}
              {noteState === "saved" ? "בתור" : "שלח למוח"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
