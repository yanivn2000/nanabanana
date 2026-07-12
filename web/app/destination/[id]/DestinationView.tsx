"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Star, Search, Compass } from "lucide-react";
import { MapClient } from "@/components/MapClient";
import { CityPoster } from "@/components/CityPoster";
import { descriptor, catColor, bigImage, mergeCat } from "@/lib/labels";
import { passUrl, type Pass } from "@/lib/passes";
import type { Attraction, Destination, Insight } from "@/lib/db";

// Emoji per insight kind — quick visual cue for the source of the tip.
const KIND_ICON: Record<string, string> = {
  tip: "💡", warning: "⚠️", verdict: "👍", food: "🍽️", season: "🗓️", access: "♿",
};

const CAT_HE: Record<string, string> = {
  nature: "טבע", museum: "מוזיאון", attraction: "אטרקציה", sport: "ספורט",
  food: "אוכל", shopping: "קניות", tourism: "תיירות", leisure: "פנאי", historic: "היסטורי",
};
const SEASON_HE: Record<string, string> = {
  all: "כל השנה", spring: "אביב", summer: "קיץ", autumn: "סתיו", winter: "חורף",
};
const COST_HE = ["חינם", "₪", "₪₪", "₪₪₪"];

function meta(a: Attraction): string {
  const parts = [CAT_HE[mergeCat(a.category)] ?? a.category];
  if (a.best_season && SEASON_HE[a.best_season]) parts.push(SEASON_HE[a.best_season]);
  return parts.join(" · ");
}

export function DestinationView({
  dest,
  attractions,
  insights = {},
  placeGroups = [],
  passes = [],
  coveredIds = [],
}: {
  dest: Destination;
  attractions: Attraction[];
  insights?: Record<number, Insight[]>;
  placeGroups?: { name: string; items: Insight[] }[];
  passes?: Pass[];
  coveredIds?: number[];
}) {
  const covered = new Set(coveredIds);
  const [selected, setSelected] = useState<Attraction | null>(null);
  const [query, setQuery] = useState("");
  const [showPlaces, setShowPlaces] = useState(false);
  const [showPasses, setShowPasses] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [flags, setFlags] = useState({
    mustSee: false, free: false, indoor: false, top: false, withInsights: false,
  });
  const toggleFlag = (k: keyof typeof flags) =>
    setFlags((f) => ({ ...f, [k]: !f[k] }));
  // #13 — narrow the list to what's currently visible on the map.
  const [mapOnly, setMapOnly] = useState(false);
  const [bounds, setBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);

  const cats = useMemo(
    () => Array.from(new Set(attractions.map((a) => mergeCat(a.category)))),
    [attractions]
  );
  const filtered = useMemo(
    () =>
      attractions.filter((a) => {
        if (activeCat && mergeCat(a.category) !== activeCat) return false;
        if (flags.mustSee && a.must_see !== 1) return false;
        if (flags.free && a.cost_level !== 0) return false;
        if (flags.indoor && !(a.indoor_outdoor === "indoor" || a.indoor_outdoor === "both")) return false;
        if (flags.top && (a.family_score ?? 0) < 8) return false;
        if (flags.withInsights && !insights[a.id]?.length) return false;
        if (query) {
          const hay = `${a.name_he ?? ""} ${a.name_en} ${descriptor(a)}`.toLowerCase();
          if (!hay.includes(query.toLowerCase())) return false;
        }
        return true;
      }),
    [attractions, activeCat, query, flags, insights]
  );

  const mustSee = useMemo(
    () => attractions.filter((a) => a.must_see === 1 && a.image_url).slice(0, 12),
    [attractions]
  );

  // The list shows the filtered set, optionally narrowed to the map viewport.
  const listItems = useMemo(() => {
    if (!mapOnly || !bounds) return filtered;
    return filtered.filter((a) =>
      a.lat != null && a.lng != null &&
      a.lat <= bounds.north && a.lat >= bounds.south &&
      a.lng <= bounds.east && a.lng >= bounds.west);
  }, [filtered, mapOnly, bounds]);

  return (
    <main className="mx-auto w-full max-w-[440px] pb-28 lg:max-w-none lg:pb-0">
      {/* poster hero */}
      <CityPoster destinationId={dest.id} cityHe={dest.city_he || dest.city} overlay
        className="h-[210px] lg:h-[300px]">
        <Link href="/" className="eyebrow absolute right-5 top-5 inline-flex items-center gap-1 text-white/85 lg:right-8">
          <ChevronRight size={14} /> בית
        </Link>
        <div className="absolute inset-x-0 bottom-0 px-5 pb-5 lg:px-8 lg:pb-6">
          <p className="text-[12px] font-medium tracking-wide text-white/85">{dest.country_he || dest.country}</p>
          <h1 className="serif text-[38px] font-bold leading-none text-white lg:text-[52px]">{dest.city_he || dest.city}</h1>
        </div>
      </CityPoster>

      {/* editorial header */}
      <header className="rise bg-[var(--surface)] px-5 pb-6 pt-5 lg:px-8">
        <p className="text-[13px] text-[var(--text-2)]">
          {dest.attraction_count.toLocaleString("he")} מקומות במאגר
        </p>

        {/* חקירת יעד — the guided, personalized exploration flow */}
        <Link href={`/explore/${dest.id}`}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-4 py-2.5 text-[13.5px] font-medium text-white shadow-[var(--shadow)]">
          <Compass size={16} /> חקרו את היעד לפי מי שאתם
        </Link>

        {/* money-saving pass badge (#16) */}
        {passes.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowPasses((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition"
              style={{ background: "var(--brand-soft)", color: "var(--brand-ink)", border: "1px solid var(--brand)" }}>
              💳 כרטיס חוסך כסף {showPasses ? "▴" : "▾"}
            </button>
            {showPasses && (
              <div className="mt-2 flex flex-col gap-2 lg:max-w-md">
                {passes.map((p) => (
                  <a key={p.name} href={passUrl(p.name)} target="_blank" rel="noreferrer"
                    className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow)]">
                    <span className="shrink-0">💳</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium">{p.name}</span>
                      <span className="block text-[12px] text-[var(--text-2)]">{p.note_he}</span>
                    </span>
                    <span className="shrink-0 self-center text-[12px] text-[var(--brand-ink)]">פרטים ↗</span>
                  </a>
                ))}
                {passes.some((p) => p.included?.length) && (
                  <p className="text-[11.5px] text-[var(--brand-ink)]">
                    אטרקציות שמסומנות 💳 ברשימה נכללות בכרטיס{passes.find((p) => p.updated)?.updated ? ` (עודכן ${passes.find((p) => p.updated)!.updated})` : ""}.
                  </p>
                )}
                <p className="text-[11px] text-[var(--text-3)]">כרטיס אזורי/עירוני שיכול לחסוך על תחבורה וכניסות. הכיסוי משתנה מעת לעת — אמתו את הרשימה המלאה באתר הרשמי.</p>
              </div>
            )}
          </div>
        )}
      </header>

      {/* editor's picks rail (must-see) */}
      {mustSee.length > 0 && (
        <section className="rise rise-1 border-y border-[var(--border)] bg-[var(--surface-2)] py-5">
          <p className="eyebrow mb-3 px-5 lg:px-8">בחירת העורך · חובה לביקור</p>
          <div className="flex gap-3 overflow-x-auto px-5 pb-1 lg:px-8">
            {mustSee.map((a) => (
              <button key={a.id} onClick={() => setSelected(a)}
                className="group w-[200px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface)] text-right shadow-[var(--shadow)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bigImage(a.image_url, 480)} alt="" loading="lazy"
                  onError={(e) => { const t = e.currentTarget; if (t.src !== a.image_url) t.src = a.image_url as string; }}
                  className="h-[150px] w-full object-cover" />
                <div className="p-3">
                  <p className="eyebrow">{meta(a)}</p>
                  <p className="serif mt-1 text-[16px] leading-tight">{a.name_he || a.name_en}</p>
                  {a.tagline_he && (
                    <p className="mt-1 text-[12.5px] italic text-[var(--text-2)]">{a.tagline_he}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Recommended specific places we don't have as attractions (hotels,
          restaurants, tours, day-trips) — from travelers, grouped by place. */}
      {placeGroups.length > 0 && (
        <section className="rise border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4 lg:px-8">
          <button onClick={() => setShowPlaces((v) => !v)}
            className="flex w-full items-center justify-between text-right">
            <span className="text-[15px] font-medium">
              🏨 מלונות, אוכל והמלצות ממטיילים
              <span className="mr-1.5 text-[13px] font-normal text-[var(--text-3)]">({placeGroups.length} מקומות)</span>
            </span>
            <span className="text-[13px] text-[var(--brand-ink)]">{showPlaces ? "הסתר ▴" : "הצג ▾"}</span>
          </button>
          {showPlaces && (
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {placeGroups.slice(0, 120).map((g) => (
                <div key={g.name} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <p className="mb-1 text-[13.5px] font-medium">
                    {g.name}
                    {g.items.length > 1 && (
                      <span className="mr-1 text-[11.5px] font-normal text-[var(--text-3)]">· {g.items.length} מטיילים</span>
                    )}
                  </p>
                  <div className="flex flex-col gap-1">
                    {g.items.map((ins) => (
                      <p key={ins.id} className="flex items-start gap-1 text-[12.5px] leading-snug text-[var(--text-2)]">
                        <span className="shrink-0">{KIND_ICON[ins.kind] ?? "💬"}</span>
                        <span>{ins.text_he}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ))}
              {placeGroups.length > 120 && (
                <p className="text-[12px] text-[var(--text-3)]">מוצגים 120 המקומות שהומלצו הכי הרבה מתוך {placeGroups.length}.</p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="lg:flex lg:items-start">
        {/* map */}
        <div className="sticky top-0 z-10 h-[240px] w-full overflow-hidden border-y border-[var(--border)] lg:order-2 lg:h-[calc(100dvh-57px)] lg:top-[57px] lg:flex-1 lg:border-y-0 lg:border-s">
          <MapClient attractions={filtered} center={[dest.lat, dest.lng]} selected={selected} onBounds={setBounds} />
        </div>

        {/* list */}
        <section className="px-5 lg:order-1 lg:w-[500px] lg:shrink-0 lg:px-8 lg:pb-16">
          <div className="mb-3 mt-5 flex items-center gap-2 border-b border-[var(--border)] pb-2">
            <Search size={17} className="text-[var(--text-3)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש אטרקציה…"
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-3)]" />
          </div>

          <div className="mb-5 flex gap-4 overflow-x-auto pb-1">
            {[null, ...cats].map((c) => {
              const on = activeCat === c;
              return (
                <button key={c ?? "all"} onClick={() => setActiveCat(c)}
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-1 text-[13px] transition"
                  style={{
                    color: on ? "var(--accent-ink)" : "var(--text-2)",
                    fontWeight: on ? 500 : 400,
                    borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                  }}>
                  {c !== null && (
                    <span className="size-2.5 rounded-full" style={{ background: catColor(c) }} />
                  )}
                  {c === null ? "הכל" : CAT_HE[c] ?? c}
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {([
              ["mustSee", "⭐ חובה לביקור"],
              ["free", "חינם"],
              ["indoor", "מקורה"],
              ["top", "מומלץ במיוחד"],
            ] as const).map(([k, label]) => {
              const on = flags[k];
              return (
                <button key={k} onClick={() => toggleFlag(k)}
                  className="rounded-full px-3 py-1.5 text-[12.5px] transition"
                  style={{
                    background: on ? "var(--accent)" : "var(--surface)",
                    color: on ? "#fff" : "var(--text-2)",
                    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                  }}>
                  {label}
                </button>
              );
            })}
            <button onClick={() => toggleFlag("withInsights")}
              className="rounded-full px-3 py-1.5 text-[12.5px] transition"
              style={{
                background: flags.withInsights ? "var(--brand)" : "var(--surface)",
                color: flags.withInsights ? "#fff" : "var(--text-2)",
                border: `1px solid ${flags.withInsights ? "var(--brand)" : "var(--border)"}`,
              }}>
              💬 עם תובנות מטיילים
            </button>
            <button onClick={() => setMapOnly((v) => !v)}
              className="rounded-full px-3 py-1.5 text-[12.5px] transition"
              style={{
                background: mapOnly ? "var(--brand)" : "var(--surface)",
                color: mapOnly ? "#fff" : "var(--text-2)",
                border: `1px solid ${mapOnly ? "var(--brand)" : "var(--border)"}`,
              }}>
              📍 רק מה שעל המפה
            </button>
          </div>

          {flags.withInsights && (
            <p className="mb-2 text-[12px] text-[var(--brand-ink)]">
              מציג רק מקומות עם תובנות מטיילים ({listItems.length})
            </p>
          )}
          {mapOnly && (
            <p className="mb-2 text-[12px] text-[var(--brand-ink)]">
              מציג {listItems.length} מקומות באזור המפה — הזיזו או הגדילו את המפה לעדכון
            </p>
          )}

          <div className="flex flex-col">
            {listItems.length === 0 && (
              <p className="py-8 text-center text-[14px] text-[var(--text-3)]">
                {mapOnly ? "אין מקומות באזור המפה הנוכחי — הקטינו זום או הזיזו" : "אין תוצאות לסינון הזה"}
              </p>
            )}
            {listItems.map((a, i) => {
              const isSel = selected?.id === a.id;
              const cost = a.cost_level != null ? COST_HE[a.cost_level] : null;
              return (
                <button key={a.id} onClick={() => setSelected(a)}
                  className="flex items-start gap-3.5 border-b border-[var(--border)] py-3.5 text-right transition"
                  style={{ background: isSel ? "var(--accent-soft)" : "transparent" }}>
                  {a.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bigImage(a.image_url, 256)} alt="" loading="lazy"
                      onError={(e) => { const t = e.currentTarget; if (t.src !== a.image_url) t.src = a.image_url as string; }}
                      className="h-[84px] w-[84px] shrink-0 rounded-[8px] object-cover" />
                  ) : (
                    <div className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[8px] bg-[var(--surface-2)]">
                      <span className="serif text-[22px] text-[var(--text-3)]">{(a.name_he || a.name_en).slice(0, 1)}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="eyebrow truncate">{meta(a)}</p>
                      {a.must_see === 1 && (
                        <span className="shrink-0 bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-white">חובה</span>
                      )}
                      {covered.has(a.id) && (
                        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                          style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>💳 כלול בכרטיס</span>
                      )}
                    </div>
                    <p className="serif mt-0.5 text-[17px] leading-tight">{a.name_he || a.name_en}</p>
                    {a.tagline_he && (
                      <p className={`mt-0.5 text-[13px] italic text-[var(--text-2)] ${isSel ? "" : "truncate"}`}>{a.tagline_he}</p>
                    )}
                    {isSel && a.description_he && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">{a.description_he}</p>
                    )}
                    {insights[a.id]?.length ? (
                      isSel ? (
                        // Selected: show every traveler insight for this place.
                        <div className="mt-1.5 flex flex-col gap-1">
                          <p className="text-[11px] font-medium text-[var(--text-3)]">
                            תובנות ממטיילים ({insights[a.id].length})
                          </p>
                          {insights[a.id].map((ins) => (
                            <p key={ins.id} className="flex items-start gap-1 text-[12.5px] leading-snug text-[var(--brand-ink)]">
                              <span className="shrink-0">{KIND_ICON[ins.kind] ?? "💬"}</span>
                              <span>{ins.text_he}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        // Collapsed: teaser (first insight) + honest count of the rest.
                        <p className="mt-1 flex items-start gap-1 text-[12.5px] leading-snug text-[var(--brand-ink)]">
                          <span className="shrink-0">{KIND_ICON[insights[a.id][0].kind] ?? "💬"}</span>
                          <span className="line-clamp-2">
                            {insights[a.id][0].text_he}
                            {insights[a.id].length > 1 && (
                              <span className="text-[var(--text-3)]"> · עוד {insights[a.id].length - 1} תובנות ▾</span>
                            )}
                          </span>
                        </p>
                      )
                    ) : null}
                    <div className="mt-1.5 flex items-center gap-2.5 text-[12px] text-[var(--text-3)]">
                      {!!a.family_score && (
                        <span className="inline-flex items-center gap-0.5 text-[var(--accent-ink)]">
                          <Star size={11} fill="currentColor" /> {a.family_score}
                        </span>
                      )}
                      {cost && <span>{cost}</span>}
                      {a.best_time_he && <span className="truncate">{a.best_time_he}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
