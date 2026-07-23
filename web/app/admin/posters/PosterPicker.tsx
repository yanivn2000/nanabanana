"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ChevronDown, ExternalLink } from "lucide-react";
import type { PosterPick } from "@/lib/db";

type City = { id: number; city: string; slug: string | null };
type Cand = {
  photo_id: string; thumb: string; src_url: string; page_url: string;
  photographer: string; photographer_url: string; width: number; height: number; alt: string;
};

export function PosterPicker({ cities, initialPicks }: { cities: City[]; initialPicks: PosterPick[] }) {
  // dest_id -> currently picked photo_id
  const [picked, setPicked] = useState<Record<number, string>>(
    Object.fromEntries(initialPicks.filter((p) => p.variant === "default").map((p) => [p.dest_id, p.photo_id ?? ""]))
  );
  const [mat] = useState<Record<number, boolean>>(
    Object.fromEntries(initialPicks.filter((p) => p.variant === "default").map((p) => [p.dest_id, p.materialized]))
  );
  const [open, setOpen] = useState<number | null>(null);
  const [cands, setCands] = useState<Record<number, Cand[]>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const doneCount = Object.values(picked).filter(Boolean).length;

  async function loadCands(dest: number) {
    if (cands[dest]) return;
    setLoading(dest);
    try {
      const r = await fetch(`/api/admin/pexels?dest=${dest}`);
      const d = await r.json();
      setCands((c) => ({ ...c, [dest]: d.candidates ?? [] }));
    } finally {
      setLoading(null);
    }
  }

  function toggle(dest: number) {
    const next = open === dest ? null : dest;
    setOpen(next);
    if (next != null) loadCands(next);
  }

  async function pick(dest: number, c: Cand) {
    setSaving(c.photo_id);
    try {
      const r = await fetch("/api/admin/poster-pick", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dest_id: dest, photo_id: c.photo_id, src_url: c.src_url, page_url: c.page_url,
          photographer: c.photographer, photographer_url: c.photographer_url,
          width: c.width, height: c.height,
        }),
      });
      if (r.ok) setPicked((p) => ({ ...p, [dest]: c.photo_id }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <p className="mb-4 rounded-[var(--radius-card)] bg-[var(--brand-soft)] px-4 py-2.5 text-[14px] text-[var(--brand-ink)]">
        נבחרו {doneCount}/{cities.length} ערים
      </p>
      <div className="flex flex-col gap-2.5">
        {cities.map((city) => {
          const isOpen = open === city.id;
          const chosen = picked[city.id];
          return (
            <section key={city.id} className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
              <button onClick={() => toggle(city.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right">
                <span className="flex items-center gap-2">
                  {chosen ? <CheckCircle2 size={18} className="text-[var(--brand)]" />
                          : <span className="size-[18px] rounded-full border-2 border-[var(--border)]" />}
                  <span className="text-[16px] font-medium">{city.city}</span>
                  {/* A pick is served LIVE the moment it's chosen (via /api/poster) —
                      both states are already shown on the site. "מותאם" just means the
                      optional optimised static crops also exist (finalize_posters.py). */}
                  {chosen && !mat[city.id] && (
                    <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11.5px] text-[var(--brand-ink)]">מוצג</span>
                  )}
                  {chosen && mat[city.id] && (
                    <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11.5px] text-[var(--brand-ink)]">מוצג · מותאם</span>
                  )}
                </span>
                <ChevronDown size={18} className={`text-[var(--text-3)] transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>

              {isOpen && (
                <div className="border-t border-[var(--border)] p-4">
                  {loading === city.id ? (
                    <div className="flex items-center gap-2 py-6 text-[14px] text-[var(--text-3)]">
                      <Loader2 size={16} className="animate-spin" /> טוען מועמדות…
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {(cands[city.id] ?? []).map((c) => {
                        const sel = chosen === c.photo_id;
                        return (
                          <div key={c.photo_id}
                            className="overflow-hidden rounded-[12px] border-2 transition"
                            style={{ borderColor: sel ? "var(--brand)" : "transparent" }}>
                            <button onClick={() => pick(city.id, c)} className="relative block w-full">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={c.thumb} alt={c.alt} loading="lazy"
                                className="aspect-[3/2] w-full object-cover" />
                              {sel && (
                                <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-[var(--brand)] text-white">
                                  <CheckCircle2 size={15} />
                                </span>
                              )}
                              {saving === c.photo_id && (
                                <span className="absolute inset-0 grid place-items-center bg-black/30">
                                  <Loader2 size={20} className="animate-spin text-white" />
                                </span>
                              )}
                            </button>
                            <div className="flex items-center justify-between px-2 py-1 text-[11.5px] text-[var(--text-3)]">
                              <span className="truncate">{c.photographer}</span>
                              <a href={c.page_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                <ExternalLink size={11} />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
