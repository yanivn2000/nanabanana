"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight, Search, Sparkles, ChevronDown, SlidersHorizontal, Check, MapPin, HelpCircle, X, Loader2 } from "lucide-react";
import { MapClient } from "@/components/MapClient";
import { CityPoster } from "@/components/CityPoster";
import { descriptor, catColor, bigImage, mergeCat, countryFlag } from "@/lib/labels";
import { passUrl, type Pass } from "@/lib/passes";
import { useRouter } from "next/navigation";
import { useProfile, useTrips, useCitySelection, type Choice } from "@/lib/store";

// distance slider index → per-trip dailyDriveHours (same scale as the old flow)
const RADIUS_HOURS = [0.5, 1, 2, 3];
const RADIUS_HE = ["קרוב מאוד", "עד שעה", "עד שעתיים", "גם רחוק"];
import { deriveTaste, tasteScore, coarseFits } from "@/lib/taste";
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

// Rough visit-time label from stored minutes — a band, no fake precision.
function durationHe(min: number | null): string | null {
  if (!min) return null;
  if (min < 75) return "כשעה";
  if (min < 150) return "שעה-שעתיים";
  if (min < 240) return "חצי יום";
  return "יום שלם";
}
type SortKey = "match" | "mustsee" | "name";
const SORT_HE: Record<SortKey, string> = {
  match: "הכי מתאים לי", mustsee: "מומלצים תחילה", name: "לפי א׳–ב׳",
};

// yes / maybe / no marks on a card — the traveler's picks for the trip.
const TONE: Record<Choice, { on: string; ink: string; off: string }> = {
  yes: { on: "var(--brand)", ink: "#fff", off: "var(--brand-ink)" },
  maybe: { on: "var(--amber-fill)", ink: "#3d2c0a", off: "var(--amber)" },
  no: { on: "#c0453f", ink: "#fff", off: "#c0453f" },
};
function ChoiceBtn({ tone, active, onClick, icon, label }: {
  tone: Choice; active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  const t = TONE[tone];
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex items-center justify-center gap-1 rounded-full border py-1.5 text-[12.5px] font-medium transition"
      style={{ background: active ? t.on : "var(--surface)", color: active ? t.ink : t.off,
               borderColor: active ? t.on : "var(--border)" }}>
      {icon} {label}
    </button>
  );
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
  // family_score is a family-friendliness metric — only surface it (the
  // "מומלץ למשפחות" filter, the score star) when the traveler has kids.
  const [profile] = useProfile();
  const isFamily = profile.kids.length > 0;
  const [selected, setSelected] = useState<Attraction | null>(null);
  const [query, setQuery] = useState("");
  const [showPlaces, setShowPlaces] = useState(false);
  const [showPasses, setShowPasses] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [flags, setFlags] = useState({
    fitsProfile: false, mustSee: false, free: false, indoor: false, top: false, withInsights: false,
  });
  const toggleFlag = (k: keyof typeof flags) =>
    setFlags((f) => ({ ...f, [k]: !f[k] }));
  // #13 — narrow the list to what's currently visible on the map.
  const [mapOnly, setMapOnly] = useState(false);
  const [bounds, setBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  // Desktop tags row: sort order + the "more filters" popover.
  const [sort, setSort] = useState<SortKey>("match");
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Per-city yes/maybe/no marks (the "city profile") + the build modal.
  const { create } = useTrips();
  const { choices, setChoice, setMany } = useCitySelection(dest.id);
  const [buildOpen, setBuildOpen] = useState(false);
  const [buildDays, setBuildDays] = useState(4);
  const [buildRadius, setBuildRadius] = useState(1);
  const [building, setBuilding] = useState(false);
  const PAGE = 200;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const yesCount = Object.values(choices).filter((c) => c === "yes").length;
  const maybeCount = Object.values(choices).filter((c) => c === "maybe").length;
  // "select all must-see" — a one-click way to mark every חובה place as כן.
  const mustSeeIds = useMemo(() => attractions.filter((a) => a.must_see === 1).map((a) => a.id), [attractions]);
  const allMustSeeYes = mustSeeIds.length > 0 && mustSeeIds.every((id) => choices[id] === "yes");
  const toggleAllMustSee = () => setMany(mustSeeIds, allMustSeeYes ? null : "yes");

  const cats = useMemo(
    () => Array.from(new Set(attractions.map((a) => mergeCat(a.category)))),
    [attractions]
  );
  // "מתאים לפרופיל שלי" — pure client-side match on the already-loaded
  // attractions. Taste-tagged cities (London) use the precise taste score;
  // everywhere else falls back to a coarse interests→categories match.
  const router = useRouter();
  const taste = useMemo(() => deriveTaste(profile), [profile]);
  const cityTasteTagged = useMemo(() => attractions.some((a) => a.taste_tags?.length), [attractions]);
  const hasPrefs = profile.interests.length > 0;
  const filtered = useMemo(
    () =>
      attractions.filter((a) => {
        if (flags.fitsProfile) {
          const fits = cityTasteTagged
            ? tasteScore(a.taste_tags, taste) >= 3
            : coarseFits(mergeCat(a.category), a.subcategory, profile.interests);
          if (!fits) return false;
        }
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
    [attractions, activeCat, query, flags, insights, taste, cityTasteTagged, profile.interests]
  );

  // The list shows the filtered set, optionally narrowed to the map viewport.
  const listItems = useMemo(() => {
    if (!mapOnly || !bounds) return filtered;
    return filtered.filter((a) =>
      a.lat != null && a.lng != null &&
      a.lat <= bounds.north && a.lat >= bounds.south &&
      a.lng <= bounds.east && a.lng >= bounds.west);
  }, [filtered, mapOnly, bounds]);

  // Sort the visible list. "חובה לביקור" ALWAYS leads, no matter the sort mode.
  // Within each group, places WITH a photo come before the (still under-enriched)
  // image-less long tail, so the browse never opens on empty cards. The chosen
  // sort then orders within those sub-groups.
  const sortedItems = useMemo(() => {
    const ms = (a: Attraction) => (a.must_see === 1 ? 1 : 0);
    const img = (a: Attraction) => (a.image_url ? 1 : 0);
    const within = (a: Attraction, b: Attraction) => {
      if (sort === "name") return (a.name_he || a.name_en).localeCompare(b.name_he || b.name_en, "he");
      if (sort === "match" && cityTasteTagged) return tasteScore(b.taste_tags, taste) - tasteScore(a.taste_tags, taste);
      return (b.family_score ?? 0) - (a.family_score ?? 0);
    };
    return [...listItems].sort((a, b) =>
      ms(b) - ms(a) || img(b) - img(a) || within(a, b));
  }, [listItems, sort, cityTasteTagged, taste]);

  // Paginate the list: show PAGE at a time, "load more" reveals the next page.
  // Search + filters run over the FULL loaded city, so search always finds a
  // place even if it ranks beyond the first page. Reset to page 1 on any change.
  useEffect(() => { setVisibleCount(PAGE); }, [query, activeCat, flags, mapOnly, sort]);
  const visible = sortedItems.slice(0, visibleCount);

  // The extra filters tucked behind the desktop "פילטרים" popover.
  const moreFilterCount = (flags.indoor ? 1 : 0) + (flags.withInsights ? 1 : 0) + (mapOnly ? 1 : 0);

  // Faceted counts shown on each tag. A facet's count respects every OTHER
  // active filter but not itself — i.e. "how many remain if I add this one".
  const facet = useMemo(() => {
    const catOf = (a: Attraction) => mergeCat(a.category);
    const q = query.toLowerCase();
    const mQ = (a: Attraction) => !q || `${a.name_he ?? ""} ${a.name_en} ${descriptor(a)}`.toLowerCase().includes(q);
    const mMap = (a: Attraction) => !mapOnly || !bounds ||
      (a.lat != null && a.lng != null && a.lat <= bounds.north && a.lat >= bounds.south && a.lng <= bounds.east && a.lng >= bounds.west);
    const pred: Record<keyof typeof flags, (a: Attraction) => boolean> = {
      fitsProfile: (a) => cityTasteTagged ? tasteScore(a.taste_tags, taste) >= 3 : coarseFits(catOf(a), a.subcategory, profile.interests),
      mustSee: (a) => a.must_see === 1,
      free: (a) => a.cost_level === 0,
      indoor: (a) => a.indoor_outdoor === "indoor" || a.indoor_outdoor === "both",
      top: (a) => (a.family_score ?? 0) >= 8,
      withInsights: (a) => !!insights[a.id]?.length,
    };
    const active = (Object.keys(flags) as (keyof typeof flags)[]).filter((k) => flags[k]);
    // category counts: query + map + all active flags (but not the category itself)
    const cats: Record<string, number> = {};
    let allCount = 0;
    for (const a of attractions) {
      if (!mQ(a) || !mMap(a) || !active.every((k) => pred[k](a))) continue;
      allCount++;
      const c = catOf(a); cats[c] = (cats[c] ?? 0) + 1;
    }
    // flag counts: query + map + activeCat + the OTHER active flags + this flag
    const flagCount = {} as Record<keyof typeof flags, number>;
    (Object.keys(pred) as (keyof typeof flags)[]).forEach((key) => {
      const others = active.filter((k) => k !== key);
      flagCount[key] = attractions.filter((a) =>
        mQ(a) && mMap(a) && (!activeCat || catOf(a) === activeCat) && others.every((k) => pred[k](a)) && pred[key](a)).length;
    });
    return { cats, allCount, flagCount };
  }, [attractions, query, mapOnly, bounds, flags, activeCat, cityTasteTagged, taste, insights, profile.interests]);

  // Build a trip from the city marks (yes = anchors, maybe = "if time", no =
  // excluded). Empty selection is fine — the builder falls back to the
  // profile-matched must-sees. Days + distance come from the modal. We hand off
  // to the trip page with ?build=1 so it starts building immediately.
  function buildTrip() {
    const yes: number[] = [], maybe: number[] = [], no: number[] = [];
    for (const [id, c] of Object.entries(choices)) {
      (c === "yes" ? yes : c === "maybe" ? maybe : no).push(Number(id));
    }
    setBuilding(true);
    const trip = create({
      title: `טיול ל${dest.city_he || dest.city}`,
      mode: "preferences",
      city: dest.city,
      cityHe: dest.city_he || dest.city,
      country: dest.country,
      destinationId: dest.id,
      days: buildDays,
      month: new Date().getMonth() + 1,   // a default season; exact dates are set on the trip page
      profile: { ...profile, taste, dailyDriveHours: RADIUS_HOURS[buildRadius] },
      ...(yes.length || maybe.length || no.length ? { selection: { yes, maybe, no } } : {}),
    });
    router.push(`/trip/${trip.id}?build=1`);
  }

  return (
    <main className="mx-auto w-full max-w-[440px] pb-28 lg:max-w-none lg:pb-0">
      {/* compact card hero — a small landscape thumbnail + flag/city + a
          personalized CTA (the trip page's hero language), so the map + list
          are reachable right away */}
      <header className="rise px-5 pt-3 pb-2.5 lg:px-8 lg:pt-4 lg:pb-3">
        <Link href="/" className="eyebrow mb-2 inline-flex items-center gap-1 text-[var(--text-2)]">
          <ChevronRight size={14} /> בית
        </Link>
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)] sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            {/* landscape thumbnail — at the start (right in RTL) */}
            <div className="relative aspect-[3/2] w-[104px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] sm:w-[150px] lg:w-[188px]">
              <CityPoster destinationId={dest.id} cityHe={dest.city_he || dest.city}
                orientation="landscape" position="50% 45%" className="absolute inset-0 size-full" />
            </div>
            <div className="min-w-0">
              <h1 className="serif flex items-center gap-2 text-[24px] font-bold leading-tight lg:text-[30px]">
                <span className="text-[0.72em]">{countryFlag(dest.country)}</span>
                {dest.city_he || dest.city}
              </h1>
              <p className="mt-1 text-[14.5px] font-semibold text-[var(--text)]">
                {dest.attraction_count.toLocaleString("he")} מקומות לגלות בעיר
              </p>
              <p className="mt-0.5 text-[13.5px] text-[var(--text-2)]">אטרקציות והמלצות שנבחרו לפי ההעדפות שלכם</p>
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--brand-ink)]">
                <Sparkles size={13} /> מותאם לפרופיל שלכם
              </span>
            </div>
          </div>
          {/* actions — build CTA (opens the days/distance modal, then builds a
              trip from the city marks), pass toggle to its left (secondary). */}
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <button onClick={() => setBuildOpen(true)}
              className="flex items-center justify-center gap-2 rounded-full border-[1.5px] border-transparent bg-[var(--brand)] px-5 py-3 text-[15px] font-medium text-white shadow-[0_6px_16px_rgba(14,107,94,.3)]">
              <Sparkles size={17} /> בנו לי טיול
            </button>
            {passes.length > 0 && (
              <button onClick={() => setShowPasses((v) => !v)}
                className="flex items-center justify-center gap-2 rounded-full border-[1.5px] border-[var(--brand)] bg-[var(--surface)] px-5 py-3 text-[15px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-soft)]">
                💳 כרטיס חוסך כסף {showPasses ? "▴" : "▾"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* pass panel — reveals smoothly under the hero so the poster never jumps */}
      {passes.length > 0 && (
        <div className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: showPasses ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="mx-auto max-w-[1600px] px-5 pb-1 pt-3 lg:px-8">
              <div className="flex flex-col gap-2 lg:max-w-md">
                {passes.map((p) => (
                  <a key={p.name} href={passUrl(p.name)} target="_blank" rel="noreferrer"
                    className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow)]">
                    <span className="shrink-0">💳</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-medium">{p.name}</span>
                      <span className="block text-[13px] text-[var(--text-2)]">{p.note_he}</span>
                    </span>
                    <span className="shrink-0 self-center text-[13px] text-[var(--brand-ink)]">פרטים ↗</span>
                  </a>
                ))}
                {passes.some((p) => p.included?.length) && (
                  <p className="text-[12.5px] text-[var(--brand-ink)]">
                    אטרקציות שמסומנות 💳 ברשימה נכללות בכרטיס{passes.find((p) => p.updated)?.updated ? ` (עודכן ${passes.find((p) => p.updated)!.updated})` : ""}.
                  </p>
                )}
                <p className="text-[12px] text-[var(--text-3)]">כרטיס אזורי/עירוני שיכול לחסוך על תחבורה וכניסות. הכיסוי משתנה מעת לעת — אמתו את הרשימה המלאה באתר הרשמי.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* desktop toolbar — one sticky block under the hero: categories + search
          (row 1), then quick tags · sort · filters (row 2). Sits on the cream
          page background (not a white slab) so the hero card floats above it. */}
      <div className="sticky top-[57px] z-30 hidden bg-[var(--bg)] shadow-[0_10px_12px_-12px_rgba(16,29,43,0.12)] lg:block">
        <div className="mx-auto max-w-[1600px] px-8">
          {/* row 1 — categories (right) + search (left) */}
          <div className="flex items-center gap-5 border-b border-[var(--border)] py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-6 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {[null, ...cats].map((c) => {
                const on = activeCat === c;
                return (
                  <button key={c ?? "all"} onClick={() => setActiveCat(c)}
                    className="shrink-0 whitespace-nowrap border-b-2 pb-2 pt-1.5 text-[15px] transition"
                    style={{ color: on ? "var(--text)" : "var(--text-2)", fontWeight: on ? 600 : 400,
                             borderColor: on ? "var(--brand)" : "transparent" }}>
                    {c === null ? "הכל" : CAT_HE[c] ?? c}
                    <span className="text-[var(--text-3)]"> {c === null ? facet.allCount : facet.cats[c] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex w-[320px] shrink-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
              <Search size={16} className="shrink-0 text-[var(--text-3)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש אטרקציה, שכונה או סוג מקום…"
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]" />
            </div>
          </div>

          {/* row 2 — quick tags (right) · divider · sort + filters (left) */}
          <div className="flex items-center gap-2.5 py-2">
            <button
              onClick={() => { if (!hasPrefs) { router.push("/profile"); return; } toggleFlag("fitsProfile"); }}
              title={hasPrefs ? undefined : "מלאו מה מעניין אתכם בפרופיל"}
              className="rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition"
              style={{ background: flags.fitsProfile ? "var(--brand)" : "var(--brand-soft)",
                       color: flags.fitsProfile ? "#fff" : "var(--brand-ink)", border: "1.5px solid var(--brand)" }}>
              ✨ מתאים לי <span className="opacity-70">{facet.flagCount.fitsProfile}</span>
            </button>
            {([["mustSee", "⭐ חובה לביקור"], ["free", "חינם"],
               ...(isFamily ? [["top", "מומלץ למשפחות"]] : [])] as [keyof typeof flags, string][]).map(([k, label]) => (
              <button key={k} onClick={() => toggleFlag(k)}
                className="rounded-full px-3 py-1.5 text-[13.5px] transition"
                style={{ background: flags[k] ? "var(--accent)" : "var(--surface)",
                         color: flags[k] ? "#fff" : "var(--text-2)",
                         border: `1px solid ${flags[k] ? "var(--accent)" : "var(--border)"}` }}>
                {label} <span className="opacity-60">{facet.flagCount[k]}</span>
              </button>
            ))}

            {mustSeeIds.length > 0 && (
              <button onClick={toggleAllMustSee}
                className="flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition"
                style={{ background: allMustSeeYes ? "var(--brand)" : "var(--surface)",
                         color: allMustSeeYes ? "#fff" : "var(--brand-ink)", borderColor: "var(--brand)" }}>
                {allMustSeeYes ? <Check size={14} /> : <Sparkles size={14} />}
                {allMustSeeYes ? "כל החובה נבחרו · בטל" : `בחר את כל אתרי החובה · ${mustSeeIds.length}`}
              </button>
            )}

            <span className="mx-1 h-5 w-px shrink-0 bg-[var(--border)]" />

            {/* sort */}
            <div className="relative shrink-0">
              <button onClick={() => { setSortOpen((o) => !o); setFiltersOpen(false); }}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-[13.5px] text-[var(--text-2)]">
                מיון: <span className="font-medium text-[var(--text)]">{SORT_HE[sort]}</span>
                <ChevronDown size={14} className={sortOpen ? "rotate-180" : ""} />
              </button>
              {sortOpen && (
                <div className="absolute z-40 mt-1 w-44 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
                  {(Object.keys(SORT_HE) as SortKey[]).map((k) => (
                    <button key={k} onClick={() => { setSort(k); setSortOpen(false); }}
                      className="block w-full px-3 py-2 text-right text-[13.5px] transition hover:bg-[var(--surface-2)]"
                      style={{ color: sort === k ? "var(--brand-ink)" : "var(--text-2)", fontWeight: sort === k ? 600 : 400 }}>
                      {SORT_HE[k]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* filters popover — the less-used toggles */}
            <div className="relative shrink-0">
              <button onClick={() => { setFiltersOpen((o) => !o); setSortOpen(false); }}
                className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13.5px] transition"
                style={{ borderColor: moreFilterCount ? "var(--brand)" : "var(--border)",
                         background: moreFilterCount ? "var(--brand-soft)" : "var(--surface)",
                         color: moreFilterCount ? "var(--brand-ink)" : "var(--text-2)" }}>
                <SlidersHorizontal size={15} /> פילטרים{moreFilterCount ? ` · ${moreFilterCount}` : ""}
                <ChevronDown size={14} className={filtersOpen ? "rotate-180" : ""} />
              </button>
              {filtersOpen && (
                <div className="absolute z-40 mt-1 w-56 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow)]">
                  {([["indoor", "מקורה"], ["withInsights", "💬 עם תובנות מטיילים"]] as [keyof typeof flags, string][]).map(([k, label]) => (
                    <button key={k} onClick={() => toggleFlag(k)}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-right text-[13.5px] transition hover:bg-[var(--surface-2)]">
                      <span style={{ color: flags[k] ? "var(--brand-ink)" : "var(--text-2)", fontWeight: flags[k] ? 600 : 400 }}>
                        {label} <span className="text-[var(--text-3)]">{facet.flagCount[k]}</span>
                      </span>
                      {flags[k] && <Check size={15} className="text-[var(--brand)]" />}
                    </button>
                  ))}
                  <button onClick={() => setMapOnly((v) => !v)}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-right text-[13.5px] transition hover:bg-[var(--surface-2)]">
                    <span style={{ color: mapOnly ? "var(--brand-ink)" : "var(--text-2)", fontWeight: mapOnly ? 600 : 400 }}>📍 רק מה שעל המפה</span>
                    {mapOnly && <Check size={15} className="text-[var(--brand)]" />}
                  </button>
                </div>
              )}
            </div>

            <span className="mr-auto shrink-0 text-[13px] text-[var(--text-3)]">{sortedItems.length} מקומות</span>
          </div>
        </div>
      </div>

      {/* (Editor's-picks rail removed — the list below has a "חובה לביקור" filter.) */}

      {/* Recommended specific places we don't have as attractions (hotels,
          restaurants, tours, day-trips) — from travelers, grouped by place. */}
      {placeGroups.length > 0 && (
        <section className="rise border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4 lg:px-8">
          <button onClick={() => setShowPlaces((v) => !v)}
            className="flex w-full items-center justify-between text-right">
            <span className="text-[16px] font-medium">
              🏨 מלונות, אוכל והמלצות ממטיילים
              <span className="mr-1.5 text-[14px] font-normal text-[var(--text-3)]">({placeGroups.length} מקומות)</span>
            </span>
            <span className="text-[14px] text-[var(--brand-ink)]">{showPlaces ? "הסתר ▴" : "הצג ▾"}</span>
          </button>
          {showPlaces && (
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {placeGroups.slice(0, 120).map((g) => (
                <div key={g.name} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <p className="mb-1 text-[14.5px] font-medium">
                    {g.name}
                    {g.items.length > 1 && (
                      <span className="mr-1 text-[12.5px] font-normal text-[var(--text-3)]">· {g.items.length} מטיילים</span>
                    )}
                  </p>
                  <div className="flex flex-col gap-1">
                    {g.items.map((ins) => (
                      <p key={ins.id} className="flex items-start gap-1 text-[13.5px] leading-snug text-[var(--text-2)]">
                        <span className="shrink-0">{KIND_ICON[ins.kind] ?? "💬"}</span>
                        <span>{ins.text_he}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ))}
              {placeGroups.length > 120 && (
                <p className="text-[13px] text-[var(--text-3)]">מוצגים 120 המקומות שהומלצו הכי הרבה מתוך {placeGroups.length}.</p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="lg:flex lg:items-start">
        {/* map — a narrow sticky rail on desktop; full-width strip on mobile */}
        <div className="sticky top-0 z-10 h-[240px] w-full overflow-hidden border-y border-[var(--border)] lg:order-2 lg:h-[calc(100dvh-164px)] lg:top-[164px] lg:w-[380px] lg:shrink-0 lg:border-y-0 lg:border-s">
          <MapClient attractions={visible} center={[dest.lat, dest.lng]} selected={selected} onBounds={setBounds} />
        </div>

        {/* attraction cards — a grid on desktop, single column on mobile */}
        <section className="px-5 lg:order-1 lg:min-w-0 lg:flex-1 lg:px-8 lg:pb-16">
          {/* mobile filter header (search + categories + quick tags) — desktop
              uses the toolbar above */}
          <div className="sticky top-[240px] z-20 -mx-5 bg-[var(--bg)] px-5 pb-2 pt-4 shadow-[0_8px_10px_-10px_rgba(16,29,43,0.2)] lg:hidden">
            <div className="mb-3 flex items-center gap-2.5 border-b border-[var(--border)] pb-2">
              <span className="serif shrink-0 text-[16px] font-bold text-[var(--text)]">{dest.city_he || dest.city}</span>
              <span className="h-4 w-px shrink-0 bg-[var(--border)]" />
              <Search size={16} className="shrink-0 text-[var(--text-3)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש אטרקציה…"
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]" />
            </div>
            <div className="mb-3 flex gap-4 overflow-x-auto pb-1">
              {[null, ...cats].map((c) => {
                const on = activeCat === c;
                return (
                  <button key={c ?? "all"} onClick={() => setActiveCat(c)}
                    className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-1 text-[14px] transition"
                    style={{ color: on ? "var(--accent-ink)" : "var(--text-2)", fontWeight: on ? 500 : 400,
                             borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}` }}>
                    {c !== null && <span className="size-2.5 rounded-full" style={{ background: catColor(c) }} />}
                    {c === null ? "הכל" : CAT_HE[c] ?? c}
                    <span className="text-[var(--text-3)]">{c === null ? facet.allCount : facet.cats[c] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { if (!hasPrefs) { router.push("/profile"); return; } toggleFlag("fitsProfile"); }}
                className="rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition"
                style={{ background: flags.fitsProfile ? "var(--brand)" : "var(--brand-soft)",
                         color: flags.fitsProfile ? "#fff" : "var(--brand-ink)", border: "1.5px solid var(--brand)" }}>
                ✨ מתאים לי <span className="opacity-70">{facet.flagCount.fitsProfile}</span>
              </button>
              {([["mustSee", "⭐ חובה"], ["free", "חינם"], ["indoor", "מקורה"],
                 ...(isFamily ? [["top", "למשפחות"]] : [])] as [keyof typeof flags, string][]).map(([k, label]) => (
                <button key={k} onClick={() => toggleFlag(k)}
                  className="rounded-full px-3 py-1.5 text-[13.5px] transition"
                  style={{ background: flags[k] ? "var(--accent)" : "var(--surface)", color: flags[k] ? "#fff" : "var(--text-2)",
                           border: `1px solid ${flags[k] ? "var(--accent)" : "var(--border)"}` }}>{label} <span className="opacity-60">{facet.flagCount[k]}</span></button>
              ))}
              <button onClick={() => setMapOnly((v) => !v)}
                className="rounded-full px-3 py-1.5 text-[13.5px] transition"
                style={{ background: mapOnly ? "var(--brand)" : "var(--surface)", color: mapOnly ? "#fff" : "var(--text-2)",
                         border: `1px solid ${mapOnly ? "var(--brand)" : "var(--border)"}` }}>📍 על המפה</button>
              {mustSeeIds.length > 0 && (
                <button onClick={toggleAllMustSee}
                  className="rounded-full px-3 py-1.5 text-[13.5px] font-medium transition"
                  style={{ background: allMustSeeYes ? "var(--brand)" : "var(--surface)",
                           color: allMustSeeYes ? "#fff" : "var(--brand-ink)", border: "1px solid var(--brand)" }}>
                  {allMustSeeYes ? "✓ כל החובה" : `⭐ בחר את כל החובה · ${mustSeeIds.length}`}
                </button>
              )}
            </div>
          </div>

          {(flags.withInsights || mapOnly) && (
            <p className="pt-3 text-[13px] text-[var(--brand-ink)] lg:pt-4">
              {mapOnly ? `מציג ${sortedItems.length} מקומות באזור המפה — הזיזו/הגדילו את המפה`
                       : `מציג רק מקומות עם תובנות מטיילים (${sortedItems.length})`}
            </p>
          )}

          {sortedItems.length === 0 && (
            <p className="py-10 text-center text-[15px] text-[var(--text-3)]">
              {mapOnly ? "אין מקומות באזור המפה הנוכחי — הקטינו זום או הזיזו" : "אין תוצאות לסינון הזה"}
            </p>
          )}

          {/* rich image-top cards */}
          <div className="grid grid-cols-1 gap-4 pt-3 sm:grid-cols-2 lg:pt-4 xl:grid-cols-3">
            {visible.map((a) => {
              const isSel = selected?.id === a.id;
              const cost = a.cost_level != null ? COST_HE[a.cost_level] : null;
              const dur = durationHe(a.duration_minutes);
              const cat = mergeCat(a.category);
              const insList = insights[a.id] ?? [];
              const tip = insList[0]?.text_he || a.tips_he;
              const choice = choices[a.id];
              return (
                <div key={a.id}
                  className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface)] text-right shadow-[var(--shadow)] transition hover:-translate-y-0.5"
                  style={{ borderColor: choice === "yes" || isSel ? "var(--brand)" : "var(--border)",
                           boxShadow: isSel ? "0 0 0 1.5px var(--brand)" : undefined,
                           opacity: choice === "no" ? 0.5 : 1 }}>
                  {/* clickable body — selects the place and flies the map */}
                  <button onClick={() => setSelected(a)} className="flex flex-1 flex-col text-right">
                    <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--surface-2)]">
                      {a.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={bigImage(a.image_url, 400)} alt="" loading="lazy"
                          onError={(e) => { const t = e.currentTarget; if (t.src !== a.image_url) t.src = a.image_url as string; }}
                          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                      ) : (
                        // No photo yet — a calm, branded placeholder tinted by the
                        // category (not a lonely letter), so it reads as intentional.
                        <div className="grid size-full place-items-center"
                          style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${catColor(cat)} 20%, var(--surface-2)), var(--surface-2) 72%)` }}>
                          <MapPin size={30} className="opacity-30" style={{ color: catColor(cat) }} />
                        </div>
                      )}
                      <span className="absolute right-2 top-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow-sm"
                            style={{ background: catColor(cat) }}>
                        {CAT_HE[cat] ?? a.category}
                      </span>
                      {a.must_see === 1 && (
                        <span className="absolute left-2 top-2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">⭐ חובה</span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col p-3">
                      <p className="serif truncate text-[17px] font-bold leading-tight">{a.name_he || a.name_en}</p>
                      {a.name_he && a.name_en && a.name_en !== a.name_he && (
                        <p className="truncate text-[12.5px] text-[var(--text-3)]" dir="ltr" style={{ unicodeBidi: "isolate" }}>{a.name_en}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                        {cost && <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 font-medium text-[var(--brand-ink)]">{cost}</span>}
                        {dur && <span className="text-[var(--text-3)]">🕐 {dur}</span>}
                        {covered.has(a.id) && <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 font-medium text-[var(--brand-ink)]">💳 כלול בכרטיס</span>}
                      </div>
                      {a.tagline_he && (
                        <p className={`mt-1.5 text-[13px] leading-snug text-[var(--text-2)] ${isSel ? "" : "line-clamp-2"}`}>{a.tagline_he}</p>
                      )}
                      {isSel && a.description_he && (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">{a.description_he}</p>
                      )}
                      {tip && (
                        <p className="mt-1.5 flex items-start gap-1 text-[12.5px] leading-snug text-[var(--brand-ink)]">
                          <span className="shrink-0">💡</span>
                          <span className={isSel ? "" : "line-clamp-2"}>טיפ מטיילים: {tip}</span>
                        </p>
                      )}
                      {isSel && insList.length > 1 && (
                        <div className="mt-1.5 flex flex-col gap-1">
                          {insList.slice(1).map((ins) => (
                            <p key={ins.id} className="flex items-start gap-1 text-[12.5px] leading-snug text-[var(--brand-ink)]">
                              <span className="shrink-0">{KIND_ICON[ins.kind] ?? "💬"}</span><span>{ins.text_he}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                  {/* yes / maybe / no marks — the traveler's picks for this city.
                      RTL order: כן first (right), then אולי, then לא. */}
                  <div className="grid grid-cols-3 gap-1.5 border-t border-[var(--border)] p-2">
                    <ChoiceBtn tone="yes" active={choice === "yes"} onClick={() => setChoice(a.id, "yes")} icon={<Check size={13} />} label="כן" />
                    <ChoiceBtn tone="maybe" active={choice === "maybe"} onClick={() => setChoice(a.id, "maybe")} icon={<HelpCircle size={13} />} label="אולי" />
                    <ChoiceBtn tone="no" active={choice === "no"} onClick={() => setChoice(a.id, "no")} icon={<X size={13} />} label="לא" />
                  </div>
                </div>
              );
            })}
          </div>

          {visibleCount < sortedItems.length && (
            <div className="mt-6 flex justify-center pb-4">
              <button onClick={() => setVisibleCount((v) => v + PAGE)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-6 py-2.5 text-[14px] font-medium text-[var(--brand-ink)] shadow-[var(--shadow)] transition hover:border-[var(--brand)]">
                הצג עוד · נותרו {sortedItems.length - visibleCount}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* floating build bar — appears once the traveler has marked places */}
      {yesCount + maybeCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3 shadow-[0_-8px_20px_rgba(16,29,43,0.08)] lg:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
            <p className="text-[14px] text-[var(--text-2)]">
              <span className="font-semibold text-[var(--text)]">{yesCount}</span> נבחרו לטיול
              {maybeCount ? <span className="text-[var(--text-3)]"> · {maybeCount} אולי</span> : null}
            </p>
            <button onClick={() => setBuildOpen(true)}
              className="flex items-center gap-2 rounded-full bg-[var(--brand)] px-6 py-2.5 text-[14px] font-medium text-white shadow-[0_6px_16px_rgba(14,107,94,.3)]">
              <Sparkles size={16} /> בנו טיול
            </button>
          </div>
        </div>
      )}

      {/* build modal — days + distance, then hand off to the trip page */}
      {buildOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-5"
          onClick={() => !building && setBuildOpen(false)}>
          <div className="w-full max-w-md rounded-[var(--radius-card)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="serif text-[20px] font-bold">בונים לכם את הטיול</h3>
              <button onClick={() => setBuildOpen(false)} aria-label="סגור" className="text-[var(--text-3)]"><X size={18} /></button>
            </div>
            <p className="mb-4 text-[13.5px] leading-relaxed text-[var(--text-2)]">
              {yesCount
                ? `${yesCount} מקומות שסימנתם "כן" יהיו העוגנים${maybeCount ? `, ו-${maybeCount} "אולי" ישתלבו אם יש זמן` : ""}.`
                : "לא סימנתם מקומות — נבחר את החובה-לביקור שמתאימים לכם. תמיד אפשר לסמן כן/אולי/לא כדי לכוון."}
            </p>
            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between text-[13.5px]">
                <span>כמה ימים?</span><span className="font-medium text-[var(--brand-ink)]">{buildDays} ימים</span>
              </div>
              <input type="range" min={2} max={7} value={buildDays} dir="ltr"
                onChange={(e) => setBuildDays(Number(e.target.value))}
                className="w-full accent-[var(--brand)]" />
            </div>
            <div className="mb-5">
              <div className="mb-1.5 flex items-center justify-between text-[13.5px]">
                <span>מרחק נסיעה ליום</span><span className="font-medium text-[var(--brand-ink)]">{RADIUS_HE[buildRadius]}</span>
              </div>
              <input type="range" min={0} max={3} value={buildRadius} dir="ltr"
                onChange={(e) => setBuildRadius(Number(e.target.value))}
                className="w-full accent-[var(--brand)]" />
            </div>
            <button onClick={buildTrip} disabled={building}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3.5 text-[15px] font-medium text-white disabled:opacity-60">
              {building ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />} בנו לי טיול
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
