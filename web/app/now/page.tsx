"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Navigation, MapPin, Compass, Loader2, ChevronRight, Star } from "lucide-react";
import { MapClient } from "@/components/MapClient";
import { descriptor } from "@/lib/labels";
import { formatDistance, wazeUrl, googleMapsUrl } from "@/lib/geo";
import type { Attraction, Destination } from "@/lib/db";

type NearAttraction = Attraction & { distanceKm: number };
type State =
  | { phase: "idle" }
  | { phase: "locating" }
  | { phase: "error"; msg: string }
  | { phase: "ready"; pos: [number, number]; dest: Destination; items: NearAttraction[] };

export default function NowPage() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [openId, setOpenId] = useState<number | null>(null);

  async function locate() {
    if (!("geolocation" in navigator)) {
      setState({ phase: "error", msg: "המכשיר לא תומך באיתור מיקום" });
      return;
    }
    setState({ phase: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        try {
          const res = await fetch(`/api/nearby?lat=${lat}&lng=${lng}`);
          const data = await res.json();
          if (!res.ok) {
            setState({ phase: "error", msg: data.error || "שגיאה" });
            return;
          }
          setState({ phase: "ready", pos: [lat, lng], dest: data.destination, items: data.attractions });
        } catch {
          setState({ phase: "error", msg: "שגיאת רשת" });
        }
      },
      (err) => setState({
        phase: "error",
        msg: err.code === err.PERMISSION_DENIED ? "כדי להראות מה קרוב, אשרו גישה למיקום" : "לא הצלחנו לאתר מיקום",
      }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Auto-try on mount.
  useEffect(() => { locate(); }, []);

  return (
    <main className="mx-auto w-full max-w-md px-5 pb-28 pt-8 lg:pb-12">
      <header className="rise mb-5 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)]">
          <Compass size={20} />
        </div>
        <div>
          <h1 className="text-[22px] font-bold leading-tight">מצב טיול</h1>
          <p className="text-[13px] text-[var(--text-2)]">מה קרוב אליכם עכשיו</p>
        </div>
      </header>

      {state.phase === "locating" && (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] bg-[var(--surface)] p-5 text-sm text-[var(--text-2)] shadow-[var(--shadow)]">
          <Loader2 size={18} className="animate-spin" /> מאתרים את המיקום שלכם…
        </div>
      )}

      {state.phase === "error" && (
        <div className="rounded-[var(--radius-card)] bg-[var(--amber-soft)] p-5 text-center">
          <p className="text-[14px] text-[var(--amber)]">{state.msg}</p>
          <button onClick={locate}
            className="mt-3 rounded-full bg-[var(--brand)] px-5 py-2 text-[14px] font-medium text-white">
            נסו שוב
          </button>
        </div>
      )}

      {state.phase === "ready" && (
        <>
          <p className="rise-1 mb-3 text-[13px] text-[var(--text-2)]">
            אתם ליד <span className="font-medium text-[var(--text)]">{state.dest.city_he || state.dest.city}</span> · {state.items.length} מקומות בקרבת מקום
          </p>

          <div className="rise-1 mb-5 h-[200px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
            <MapClient attractions={state.items} center={state.pos} selected={null} userPos={state.pos} />
          </div>

          <div className="flex flex-col gap-2.5">
            {state.items.map((a) => (
              <div key={a.id}
                className="flex items-stretch gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow)]">
                {a.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.image_url} alt="" loading="lazy"
                    className="size-[64px] shrink-0 rounded-[12px] object-cover" />
                ) : (
                  <div className="grid size-[64px] shrink-0 place-items-center rounded-[12px] bg-[var(--brand-soft)] text-[var(--brand-ink)]">
                    <MapPin size={22} />
                  </div>
                )}
                <div className="min-w-0 flex-1 py-0.5">
                  <button type="button" onClick={() => a.description_he && setOpenId(openId === a.id ? null : a.id)}
                    className="block w-full text-right">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[15px] font-medium leading-tight">{a.name_he || a.name_en}</p>
                      {!!a.family_score && (
                        <span className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-[var(--brand-ink)]">
                          <Star size={12} fill="currentColor" /> {a.family_score}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-[var(--text-2)]">
                      {descriptor(a)} · <span className="text-[var(--brand-ink)]">{formatDistance(a.distanceKm)}</span>
                      {a.description_he && (
                        <span className="text-[var(--text-3)]"> · {openId === a.id ? "פחות ▴" : "עוד ▾"}</span>
                      )}
                    </p>
                  </button>
                  {openId === a.id && a.description_he && (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-2)]">{a.description_he}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <a href={wazeUrl(a.lat as number, a.lng as number)} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 rounded-full bg-[var(--brand)] px-3 py-1.5 text-[12px] font-medium text-white">
                      <Navigation size={13} /> Waze
                    </a>
                    <a href={googleMapsUrl(a.lat as number, a.lng as number)} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-2)]">
                      <MapPin size={13} /> Maps
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Link href="/" className="mt-6 flex items-center justify-center gap-1 text-[13px] text-[var(--text-3)]">
        <ChevronRight size={15} /> חזרה לבית
      </Link>
    </main>
  );
}
