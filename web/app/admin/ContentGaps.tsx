"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, Check, ImageOff, FileText } from "lucide-react";

type Gap = {
  id: number; name_he: string | null; name_en: string; city: string | null; city_he: string | null;
  destination_id: number; image_url: string | null; description_he: string | null; tagline_he: string | null;
  lat: number | null; lng: number | null;
};
type Cand = { images: { url: string; label: string; source: string }[]; descriptions: { text: string; label: string; source: string }[] };

const firstSentence = (t: string) => (t.split(/(?<=[.!?])\s/)[0] || t).slice(0, 100);

export function ContentGaps() {
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [city, setCity] = useState("");            // city label filter ("" = all)
  const [open, setOpen] = useState<number | null>(null);
  const [cand, setCand] = useState<Cand | null>(null);
  const [candBusy, setCandBusy] = useState(false);
  const [form, setForm] = useState({ image_url: "", description_he: "", tagline_he: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/admin/content").then((r) => r.json()).then((d) => setGaps(d.gaps ?? [])).catch(() => setGaps([]));
  }, []);

  const cityOf = (g: Gap) => g.city_he || g.city || "—";
  const cities = gaps ? [...new Set(gaps.map(cityOf))].sort() : [];
  const shown = (gaps ?? []).filter((g) => !city || cityOf(g) === city);

  async function openRow(g: Gap) {
    if (open === g.id) { setOpen(null); return; }
    setOpen(g.id);
    setForm({ image_url: g.image_url ?? "", description_he: g.description_he ?? "", tagline_he: g.tagline_he ?? "" });
    setCand(null); setCandBusy(true);
    try {
      const r = await fetch("/api/admin/content", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "candidates", name_en: g.name_en, name_he: g.name_he, lat: g.lat, lng: g.lng }),
      });
      setCand(r.ok ? await r.json() : { images: [], descriptions: [] });
    } catch { setCand({ images: [], descriptions: [] }); }
    finally { setCandBusy(false); }
  }

  async function save(g: Gap) {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/content", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", id: g.id, image_url: form.image_url || null, description_he: form.description_he || null, tagline_he: form.tagline_he || null }),
      });
      if (!r.ok) return;
      setSaved((s) => new Set(s).add(g.id));
      setGaps((cur) => (cur ?? []).map((x) => x.id === g.id ? { ...x, image_url: form.image_url || null, description_he: form.description_he || null, tagline_he: form.tagline_he || null } : x));
      setOpen(null);
    } finally { setSaving(false); }
  }

  if (gaps === null) return <div className="flex justify-center py-10 text-[var(--text-3)]"><Loader2 className="animate-spin" /></div>;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-[14px] text-[var(--text-2)]">{shown.length} אתרי חובה עם חוסר (תמונה או תיאור). בחרו מהצעות ויקיפדיה או הזינו ידנית.</p>
        <select value={city} onChange={(e) => { setCity(e.target.value); setOpen(null); }}
          className="ms-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[14px] outline-none">
          <option value="">כל הערים ({gaps.length})</option>
          {cities.map((c) => <option key={c} value={c}>{c} ({gaps.filter((g) => cityOf(g) === c).length})</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((g) => {
          const noImg = !g.image_url; const thin = (g.description_he?.length ?? 0) < 80;
          const isOpen = open === g.id;
          return (
            <div key={g.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
              <button onClick={() => openRow(g)} className="flex w-full items-center gap-3 p-3 text-right">
                <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--surface-2)]">
                  {g.image_url ? <img src={g.image_url} alt="" className="size-full object-cover" /> : <ImageOff size={16} className="text-[var(--text-3)]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{g.name_he || g.name_en}</p>
                  <p className="truncate text-[12.5px] text-[var(--text-3)]">{cityOf(g)}</p>
                </div>
                {saved.has(g.id) && <span className="text-[var(--brand-ink)]"><Check size={16} /></span>}
                {noImg && <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] text-[var(--accent-ink)]">אין תמונה</span>}
                {thin && <span className="shrink-0 rounded-full bg-[var(--amber-soft)] px-2 py-0.5 text-[11px] text-[var(--amber)]">תיאור קצר</span>}
              </button>

              {isOpen && (
                <div className="border-t border-[var(--border)] p-3">
                  {candBusy ? (
                    <div className="flex items-center gap-2 py-3 text-[13px] text-[var(--text-3)]"><Loader2 size={14} className="animate-spin" /> מחפש בוויקיפדיה…</div>
                  ) : (
                    <>
                      {!!cand?.images.length && (
                        <div className="mb-3">
                          <p className="mb-1 text-[12px] text-[var(--text-3)]">תמונות מוצעות — לחצו לבחירה</p>
                          <div className="flex flex-wrap gap-2">
                            {cand.images.map((im, i) => (
                              <button key={i} onClick={() => setForm((f) => ({ ...f, image_url: im.url }))} title={`${im.label} · ${im.source}`}
                                className={`size-16 overflow-hidden rounded-md border-2 ${form.image_url === im.url ? "border-[var(--brand)]" : "border-transparent"}`}>
                                <img src={im.url} alt="" className="size-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!!cand?.descriptions.length && (
                        <div className="mb-3">
                          <p className="mb-1 text-[12px] text-[var(--text-3)]">תיאורים מוצעים — לחצו לשימוש</p>
                          <div className="flex flex-col gap-1.5">
                            {cand.descriptions.map((d, i) => (
                              <button key={i} onClick={() => setForm((f) => ({ ...f, description_he: d.text, tagline_he: f.tagline_he || firstSentence(d.text) }))}
                                className="rounded-md border border-[var(--border)] p-2 text-right text-[13px] leading-relaxed text-[var(--text-2)] hover:border-[var(--brand)]">
                                {d.text.slice(0, 240)}{d.text.length > 240 ? "…" : ""}
                                <span className="mt-0.5 block text-[11px] text-[var(--text-3)]">{d.label} · {d.source}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {cand && !cand.images.length && !cand.descriptions.length && (
                        <p className="mb-3 text-[13px] text-[var(--text-3)]">לא נמצאו הצעות מוויקיפדיה — הזינו ידנית.</p>
                      )}
                    </>
                  )}

                  <div className="flex flex-col gap-2">
                    <label className="text-[12px] text-[var(--text-3)]">כתובת תמונה (URL)
                      <input value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} dir="ltr"
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[13px] outline-none" />
                    </label>
                    {form.image_url && <img src={form.image_url} alt="" className="h-28 w-auto max-w-full rounded-md object-cover" />}
                    <label className="text-[12px] text-[var(--text-3)]">תיאור (עברית)
                      <textarea value={form.description_he} onChange={(e) => setForm((f) => ({ ...f, description_he: e.target.value }))} rows={3}
                        className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[13px] leading-relaxed outline-none" />
                    </label>
                    <label className="text-[12px] text-[var(--text-3)]">שורת פתיחה (tagline)
                      <input value={form.tagline_he} onChange={(e) => setForm((f) => ({ ...f, tagline_he: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[13px] outline-none" />
                    </label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => save(g)} disabled={saving}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-[14px] font-medium text-white transition hover:bg-[var(--brand-hover)] disabled:opacity-60">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} שמירה
                      </button>
                      <a href={`https://he.wikipedia.org/w/index.php?search=${encodeURIComponent(g.name_he || g.name_en)}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-[13px] text-[var(--text-2)]"><Search size={13} /> חיפוש ידני בוויקיפדיה</a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && <p className="py-8 text-center text-[14px] text-[var(--text-3)]"><FileText className="mx-auto mb-2" size={20} /> אין חוסרים בעיר הזו 🎉</p>}
      </div>
    </section>
  );
}
