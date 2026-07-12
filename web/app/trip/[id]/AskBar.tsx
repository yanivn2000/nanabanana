"use client";

import { useState } from "react";
import { ArrowUp, CloudRain, Baby, Clock, Coffee, Zap, Loader2 } from "lucide-react";

type Suggestion = { icon: typeof Clock; text: string; dayIdx?: number; chip?: string };

export function AskBar({
  onSend,
  busy,
  days,
  todayIndex = null,
  tomorrowIndex = null,
}: {
  onSend: (text: string) => void;
  busy: boolean;
  days: string[];
  todayIndex?: number | null;
  tomorrowIndex?: number | null;
}) {
  const [value, setValue] = useState("");
  // null = whole trip; otherwise a 0-based day index.
  const [scope, setScope] = useState<number | null>(null);

  // Chips show only "יום N" — the full label (with the day's theme) still goes
  // into the AI prompt via scoped().
  const short = (i: number) => (days[i] ?? `יום ${i + 1}`).split(/[—–]/)[0].trim() || `יום ${i + 1}`;

  // Wrap the request with its scope so the AI changes only what was asked.
  function scoped(text: string, dayIdx: number | null) {
    if (dayIdx == null) return `התייחס לכל ימי הטיול. ${text}`;
    return `שנה אך ורק את ${days[dayIdx] ?? `יום ${dayIdx + 1}`} (היום ה-${dayIdx + 1} בטיול), אל תיגע בשאר הימים. ${text}`;
  }

  function send(text: string, dayIdx: number | null) {
    if (busy) return;
    onSend(scoped(text, dayIdx));
  }

  function submit() {
    const t = value.trim();
    if (!t || busy) return;
    send(t, scope);
    setValue("");
  }

  // Live suggestions appear only when we're actually inside the trip dates;
  // they resolve "today"/"tomorrow" to the right absolute day automatically.
  const live: Suggestion[] = [];
  if (tomorrowIndex != null)
    live.push({ icon: CloudRain, chip: `מחר (יום ${tomorrowIndex + 1}) — גשם`,
      text: "מחר צפוי גשם — החלף לפעילויות מקורות שמתאימות לגשם", dayIdx: tomorrowIndex });
  if (todayIndex != null)
    live.push({ icon: Coffee, chip: `היום (יום ${todayIndex + 1}) — קצר`,
      text: "היום נגמר העניין — קצר את שארית היום", dayIdx: todayIndex });

  // Planning suggestions apply to whatever scope is selected above.
  const planning: Suggestion[] = [
    { icon: Clock, text: "יותר זמן חופשי, פחות עצירות" },
    { icon: Baby, text: "יום יותר נינוח ורגוע" },
    { icon: Zap, text: "יותר אינטנסיבי, למצות את הזמן" },
  ];

  return (
    <div className="mt-4 rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
      {/* scope selector — what to change */}
      <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
        <span className="shrink-0 text-[11.5px] text-[var(--text-3)]">מה לעדכן?</span>
        {[null, ...days.map((_, i) => i)].map((d) => {
          const on = scope === d;
          return (
            <button key={d ?? "all"} disabled={busy} onClick={() => setScope(d)}
              className="shrink-0 rounded-full px-2.5 py-1 text-[12px] transition disabled:opacity-50"
              style={{
                background: on ? "var(--accent)" : "var(--surface)",
                color: on ? "#fff" : "var(--text-2)",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
              }}>
              {d == null ? "כל הטיול" : short(d)}
            </button>
          );
        })}
      </div>

      {/* contextual suggestions */}
      <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
        {live.map((s) => (
          <button key={s.text} disabled={busy} onClick={() => send(s.text, s.dayIdx ?? null)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--brand)] bg-[rgba(13,148,136,.08)] px-3 py-1.5 text-[12px] text-[var(--brand-ink)] disabled:opacity-50">
            <s.icon size={13} /> {s.chip ?? s.text}
          </button>
        ))}
        {planning.map((s) => (
          <button key={s.text} disabled={busy} onClick={() => send(s.text, scope)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--text-2)] disabled:opacity-50">
            <s.icon size={13} /> {s.text}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-1.5 pr-4">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={busy}
          placeholder={busy ? "Claude מארגן מחדש…"
            : scope == null ? "מה לשנות בכל הטיול…" : `מה לשנות ב${short(scope)}…`}
          className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-3)]"
        />
        <button
          aria-label="שלח"
          onClick={submit}
          disabled={!value.trim() || busy}
          className="grid size-9 place-items-center rounded-full bg-[var(--brand)] text-white transition disabled:opacity-40"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
        </button>
      </div>
    </div>
  );
}
