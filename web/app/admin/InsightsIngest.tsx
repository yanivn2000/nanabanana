"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, Sparkles, Check, X } from "lucide-react";
import type { AdminDestination } from "@/lib/db";

type Item = { place: string; kind: string; text_he: string; sentiment: string; author?: string; keep: boolean };

const KIND_HE: Record<string, string> = {
  tip: "💡 טיפ", warning: "⚠️ אזהרה", verdict: "👍 שווה/לא", food: "🍽️ אוכל", season: "🗓️ עונה", access: "♿ נגישות",
};

// טאב "תובנות" — קליטת המלצות מטיילים: הדבקה או גרירת קובץ, ניתוח עם Claude,
// סקירה ואישור, ושמירה לשכבת הידע (אותו פייפליין כמו כלי הסטרימליט).
export function InsightsIngest({ destinations }: { destinations: AdminDestination[] }) {
  const [destId, setDestId] = useState(destinations[0]?.id ?? 0);
  const [thread, setThread] = useState(false);
  const [author, setAuthor] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<"idle" | "distilling" | "review" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<{ sources: number; saved: number; matched: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function readFile(f: File) {
    const name = f.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      setError("PDF עדיין לא נתמך כאן — המירו לטקסט (או הדביקו), או השתמשו בכלי הישן (8513).");
      return;
    }
    const t = await f.text();
    setText((cur) => (cur.trim() ? cur + "\n\n" + t : t));
    setFileName(f.name);
    setError("");
  }

  async function distill() {
    setState("distilling"); setError("");
    const dest = destinations.find((d) => d.id === destId);
    try {
      const res = await fetch("/api/admin/insights", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "distill", destination_id: destId,
          dest_name: `${dest?.city ?? ""} (${dest?.city_he ?? ""})`, text, thread }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (!data.items?.length) { setError("Claude לא מצא תובנות שימושיות בטקסט הזה."); setState("idle"); return; }
      setItems(data.items.map((it: Omit<Item, "keep">) => ({ ...it, keep: true })));
      setState("review");
    } catch (e) {
      setError((e as Error).message); setState("error");
    }
  }

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/admin/insights", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", destination_id: destId, url: url || null,
          author: author || null, raw_text: text, items: items.filter((i) => i.keep) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setSummary(data); setState("saved");
    } catch (e) {
      setError((e as Error).message); setState("error");
    }
  }

  function reset() {
    setText(""); setFileName(null); setItems([]); setSummary(null); setState("idle"); setError("");
  }

  const kept = items.filter((i) => i.keep).length;
  const authors = [...new Set(items.map((i) => i.author).filter(Boolean))];

  if (state === "saved" && summary) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="mb-1 text-[18px] font-bold text-[var(--brand-ink)]">✅ נשמר לשכבת הידע</p>
        <p className="mb-4 text-[14px] text-[var(--text-2)]">
          {summary.saved} תובנות · {summary.matched} הותאמו לאטרקציות · {summary.sources} מקורות
        </p>
        <button onClick={reset} className="rounded-full bg-[var(--brand)] px-6 py-2.5 text-[14px] font-medium text-white">
          קליטת פוסט נוסף
        </button>
      </div>
    );
  }

  if (state === "review" || state === "saving") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14.5px] font-semibold">
            Claude מצא {items.length} תובנות{authors.length > 1 ? ` מ-${authors.length} מטיילים` : ""} — בטלו מה שלא שווה שמירה:
          </p>
          <button onClick={() => setState("idle")} className="text-[13px] text-[var(--text-3)]">→ חזרה לעריכת הטקסט</button>
        </div>
        <div className="flex flex-col gap-1.5">
          {items.map((it, i) => (
            <button key={i} onClick={() => setItems((s) => s.map((x, j) => j === i ? { ...x, keep: !x.keep } : x))}
              className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border p-2.5 text-right transition"
              style={{ borderColor: it.keep ? "var(--brand)" : "var(--border)", opacity: it.keep ? 1 : 0.45,
                       background: "var(--surface)" }}>
              <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border"
                style={{ background: it.keep ? "var(--brand)" : "transparent", borderColor: it.keep ? "var(--brand)" : "var(--border)" }}>
                {it.keep && <Check size={12} className="text-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-3)]">
                  <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">{KIND_HE[it.kind] ?? it.kind}</span>
                  {it.place && <span className="font-medium text-[var(--text-2)]">{it.place}</span>}
                  {it.author && <span>· {it.author}</span>}
                </span>
                <span className="block text-[14px] leading-snug">{it.text_he}</span>
              </span>
            </button>
          ))}
        </div>
        <button onClick={save} disabled={!kept || state === "saving"}
          className="flex items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3 text-[15px] font-medium text-white disabled:opacity-50">
          {state === "saving" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          שמרו {kept} תובנות לשכבת הידע
        </button>
        {error && <p className="text-[13px] text-[#c0453f]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-[13px] text-[var(--text-3)]">יעד
          <select value={destId} onChange={(e) => setDestId(Number(e.target.value))}
            className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-[14px] text-[var(--text)]">
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>{d.city_he || d.city} · {d.country_he || d.country}</option>
            ))}
          </select>
        </label>
        <div className="text-[13px] text-[var(--text-3)]">סוג הזנה
          <div className="mt-1 flex gap-1 rounded-full bg-[var(--surface-2)] p-1">
            {[{ v: false, t: "פוסט יחיד" }, { v: true, t: "שרשור (כמה מטיילים)" }].map((o) => (
              <button key={String(o.v)} onClick={() => setThread(o.v)}
                className="flex-1 rounded-full py-1.5 text-[13.5px] font-medium transition"
                style={{ background: thread === o.v ? "var(--surface)" : "transparent",
                         color: thread === o.v ? "var(--text)" : "var(--text-2)",
                         boxShadow: thread === o.v ? "var(--shadow)" : "none" }}>
                {o.t}
              </button>
            ))}
          </div>
        </div>
        <label className="text-[13px] text-[var(--text-3)]">מקור / כותב (לא חובה)
          <input value={author} onChange={(e) => setAuthor(e.target.value)}
            placeholder="למשל: משפחת כהן, בלוג ׳מטיילים באירופה׳"
            className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-[14px] text-[var(--text)] outline-none focus:border-[var(--brand)]" />
        </label>
        <label className="text-[13px] text-[var(--text-3)]">קישור (לא חובה)
          <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" placeholder="https://…"
            className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-right text-[14px] text-[var(--text)] outline-none focus:border-[var(--brand)]" />
        </label>
      </div>

      {/* the text — paste, or drag a file onto the zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
        className="rounded-[var(--radius-card)] border-2 border-dashed p-1 transition"
        style={{ borderColor: dragOver ? "var(--brand)" : "var(--border)", background: dragOver ? "var(--brand-soft)" : "transparent" }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10}
          placeholder="הדביקו כאן את תוכן הפוסט — או גררו לכאן קובץ טקסט (txt / md)…"
          className="w-full rounded-[var(--radius-sm)] bg-[var(--surface)] p-3 text-[14px] leading-relaxed outline-none" />
        <div className="flex items-center justify-between px-2 pb-1.5">
          <button onClick={() => fileInput.current?.click()}
            className="flex items-center gap-1.5 text-[13px] text-[var(--brand-ink)]">
            <Upload size={14} /> בחירת קובץ (txt / md)
          </button>
          {fileName && (
            <span className="flex items-center gap-1 text-[12.5px] text-[var(--text-3)]">
              📄 {fileName}
              <button onClick={() => { setFileName(null); setText(""); }} aria-label="נקה"><X size={13} /></button>
            </span>
          )}
          <span className="text-[12px] text-[var(--text-3)]">{text.length.toLocaleString("he-IL")} תווים</span>
        </div>
        <input ref={fileInput} type="file" accept=".txt,.md,.text,text/plain,text/markdown" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
      </div>

      {error && <p className="text-[13px] text-[#c0453f]">{error}</p>}

      <button onClick={distill} disabled={text.trim().length < 30 || state === "distilling"}
        className="flex items-center justify-center gap-2 self-end rounded-full bg-[var(--brand)] px-7 py-3 text-[15px] font-medium text-white disabled:opacity-50">
        {state === "distilling" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {state === "distilling" ? "Claude מנתח…" : "נתחו עם Claude"}
      </button>
    </div>
  );
}
