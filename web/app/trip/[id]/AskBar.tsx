"use client";

import { useState } from "react";
import { ArrowUp, CloudRain, Baby, Clock, Loader2 } from "lucide-react";

const SUGGESTIONS = [
  { icon: CloudRain, text: "מחר גשם — תארגן מחדש" },
  { icon: Baby, text: "הקטנה עייפה, יום קליל" },
  { icon: Clock, text: "יותר זמן חופשי" },
];

export function AskBar({
  onSend,
  busy,
}: {
  onSend: (text: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const t = value.trim();
    if (!t || busy) return;
    onSend(t);
    setValue("");
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[440px] bg-gradient-to-t from-[var(--bg)] via-[var(--bg)] to-transparent px-5 pb-5 pt-8 lg:max-w-2xl lg:px-8">
      <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            disabled={busy}
            onClick={() => onSend(s.text)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--text-2)] disabled:opacity-50"
          >
            <s.icon size={13} /> {s.text}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5 pr-4 shadow-[var(--shadow)]">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={busy}
          placeholder={busy ? "Claude מארגן מחדש…" : "ספרו לי מה לשנות בטיול…"}
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
