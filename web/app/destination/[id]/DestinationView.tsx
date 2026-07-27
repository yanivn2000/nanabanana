"use client";

import { useMemo, useState, useEffect, useRef, Fragment } from "react";
import Link from "next/link";
import { ChevronRight, Search, Sparkles, ChevronDown, SlidersHorizontal, Check, MapPin, X, Loader2, LayoutGrid, List, Heart } from "lucide-react";
import { MapClient } from "@/components/MapClient";
import { CityPoster } from "@/components/CityPoster";
import { descriptor, catColor, bigImage, mergeCat, countryFlag } from "@/lib/labels";
import { passUrl, type Pass } from "@/lib/passes";
import { useRouter } from "next/navigation";
import { useProfile, useTrips, useCitySelection, type Choice } from "@/lib/store";

// distance slider index → per-trip dailyDriveHours (same scale as the old flow)
const RADIUS_HOURS = [0.5, 1, 2, 3];
const RADIUS_HE = ["קרוב מאוד", "עד שעה", "עד שעתיים", "גם רחוק"];

// Trip pace (existing profile parameter). PACE_PER_DAY is the shared capacity
// source (city page promise == heuristic builder output).
const PACES = ["רגוע", "בינוני", "אינטנסיבי"] as const;
type Pace = (typeof PACES)[number];
import { PACE_PER_DAY } from "@/lib/trip-types";
import { deriveTaste, tasteScore, coarseFits, audienceFit, INTEREST_TASTE, INTEREST_CATS, GOVERNING_INTERESTS } from "@/lib/taste";
import { PROFILES, PROFILE_HE, PROFILE_EMOJI, type Profile } from "@/lib/shortpath";

// Below this audience-fit (0-100) a place is "less relevant" for the chosen
// audience → it drops BELOW the divider (still markable), never hidden. Mirrors
// the old shortPath FIT_FLOOR so the cut is the same, just soft instead of hard.
const AUDIENCE_FIT_FLOOR = 35;
import type { Attraction, Destination, Insight, AreaCard } from "@/lib/db";

// Every interest in the profile vocabulary — used as the fallback tile set when
// the traveler hasn't set profile interests yet.
const ALL_INTERESTS = Object.keys(INTEREST_TASTE);
// Does an attraction belong to an interest? taste-tags first (precise), then the
// coarse category/subcategory map so it works in half-tagged cities too.
function matchesInterest(a: Attraction, interest: string): boolean {
  // The editor's kids rating overrides the tag/subcategory guess: an explicit
  // "yes"/"no" is authoritative; "maybe"/unset falls back to the data signals.
  if (interest === "ילדים" && a.editor_kids) {
    if (a.editor_kids === "yes") return true;
    if (a.editor_kids === "no") return false;
  }
  const tags = INTEREST_TASTE[interest];
  if (tags && a.taste_tags && a.taste_tags.some((t) => tags.includes(t))) return true;
  const m = INTEREST_CATS[interest];
  if (m) {
    const cat = mergeCat(a.category);
    if (m.cats?.includes(cat)) return true;
    if (a.subcategory && m.subs?.includes(a.subcategory)) return true;
  }
  return false;
}

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

// yes / no marks on a card — the traveler's picks for the trip.
const TONE: Record<Choice, { on: string; ink: string; off: string }> = {
  yes: { on: "var(--brand)", ink: "#fff", off: "var(--brand-ink)" },
  no: { on: "#c0453f", ink: "#fff", off: "#c0453f" },
};
// A 3-state interest pill (the same values as the profile page): tap cycles
// neutral → ✓ מעוניין → ✕ לא מעוניין → neutral. It edits the profile in place.
// Editor-only 3-state rating row (importance / kids). Click the active option
// again to clear it.
function EditorRateRow({ label, value, options, onPick }: {
  label: string;
  value: string | null;
  options: { v: string; t: string; bg: string; ink: string }[];
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2">
      <span className="w-11 shrink-0 text-[11px] font-semibold text-[var(--text-3)]">{label}</span>
      <div className="grid flex-1 grid-cols-3 gap-1">
        {options.map((o) => {
          const on = value === o.v;
          return (
            <button key={o.v} onClick={() => onPick(o.v)}
              className="rounded-full border py-1 text-[12px] font-medium transition"
              style={{ background: on ? o.bg : "var(--surface)", color: on ? o.ink : "var(--text-2)",
                       borderColor: on ? o.bg : "var(--border)" }}>
              {o.t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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

// A single LIKE toggle replaces the כן/לא pair: liked = the place is "in" (choice
// "yes"); un-liked = simply unmarked (no preference), so the builder just ignores it.
function LikeBtn({ liked, onClick }: { liked: boolean; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-pressed={liked}
      className="flex w-full items-center justify-center gap-1.5 rounded-full border py-1.5 text-[13px] font-medium transition"
      style={{ background: liked ? "var(--brand)" : "var(--surface)", color: liked ? "#fff" : "var(--text-2)",
               borderColor: liked ? "var(--brand)" : "var(--border)" }}>
      <Heart size={14} fill={liked ? "currentColor" : "none"} /> {liked ? "אהבתי" : "לייק"}
    </button>
  );
}

// Compact like — a heart that lives ON the card frame (list rows), so a row
// costs no extra full-width strip of air. Filled + brand when liked.
function HeartToggle({ liked, onClick }: { liked: boolean; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-pressed={liked}
      aria-label={liked ? "אהבתי" : "לייק"} title={liked ? "אהבתי" : "לייק"}
      className="grid shrink-0 place-items-center self-stretch px-3.5 transition hover:bg-[var(--surface-2)]"
      style={{ color: liked ? "var(--brand)" : "var(--text-3)" }}>
      <Heart size={20} fill={liked ? "currentColor" : "none"} />
    </button>
  );
}

// Headline neighbourhoods as first-class experiences — a strip above the
// attractions. A "vibe" area's draw is the area itself (markets, streets); a
// "landmark" area is a dense cluster of must-sees. Tapping the body flies the map;
// "רוצה לתייר כאן" chooses the area to tour (a separate selection from the
// attraction marks) so the builder gives it its own day.
function NeighbourhoodStrip({ areas, chosenIds, attrById, onFocus, onToggle }: {
  areas: AreaCard[]; chosenIds: Set<number>;
  attrById: Map<number, { name_he: string | null; name_en: string; must_see: number | null }>;
  onFocus: (a: AreaCard) => void; onToggle: (id: number) => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!areas.length) return null;
  return (
    <section className="mx-auto max-w-[1600px] px-5 pt-4 lg:px-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[17px] font-bold">שכונות שאסור לפספס</h2>
          {/* a chosen neighbourhood is just a rich (half/full-day) pick — it folds into
              the same "בנו לי טיול" build; no separate neighbourhoods trip. */}
          <span className="text-[13px] text-[var(--text-3)]">בחרו לתייר — הן נכנסות לטיול שלכם</span>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {areas.map((a) => {
          const vibe = a.kind === "vibe";
          const sel = chosenIds.has(a.id);
          return (
            <div key={a.id}
              className="flex w-[248px] shrink-0 flex-col rounded-[var(--radius-card)] border bg-[var(--surface)] p-3.5 shadow-[var(--shadow)] transition"
              style={{ borderColor: sel ? "var(--brand)" : "var(--border)", boxShadow: sel ? "0 0 0 1.5px var(--brand)" : undefined }}>
              <button onClick={() => onFocus(a)} className="flex flex-1 flex-col text-right">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={vibe ? { background: "var(--accent-soft)", color: "var(--accent-ink)" } : { background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
                    {vibe ? "✨ חוויית שכונה" : "⭐ חובה"}
                  </span>
                  <span className="text-[11.5px] text-[var(--text-3)]">{a.name_en}</span>
                </div>
                <h3 className="text-[16.5px] font-bold leading-tight">{a.name_he}</h3>
                {a.vibe_he && <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-[var(--text-2)]">{a.vibe_he}</p>}
                {!!a.best_for?.length && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.best_for.slice(0, 3).map((t) => (
                      <span key={t} className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-2)]">{t}</span>
                    ))}
                  </div>
                )}
              </button>
              <button onClick={() => setOpenId((v) => (v === a.id ? null : a.id))}
                className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--text-3)]">
                <span>
                  {vibe
                    ? <>השכונה עצמה היא החוויה · {a.attraction_count} מקומות</>
                    : <><b className="text-[var(--text-2)]">{a.must_count} אתרי חובה</b> כאן · {a.attraction_count} מקומות</>}
                </span>
                <ChevronDown size={14} className={`shrink-0 transition-transform ${openId === a.id ? "rotate-180" : ""}`} />
              </button>
              {openId === a.id && (
                <div className="mt-1.5 flex max-h-44 flex-wrap gap-1 overflow-y-auto">
                  {a.member_ids.map((id) => attrById.get(id)).filter(Boolean).map((m) => (
                    <span key={m!.name_en + m!.name_he} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[11.5px] text-[var(--text-2)]">
                      {m!.must_see === 1 && <span className="text-[var(--accent-ink)]">⭐</span>}
                      {m!.name_he || m!.name_en}
                    </span>
                  ))}
                </div>
              )}
              <button onClick={() => onToggle(a.id)}
                className="mt-2 flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition"
                style={sel
                  ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }
                  : { background: "var(--surface)", color: "var(--brand-ink)", borderColor: "var(--brand)" }}>
                {sel ? "✓ בטיול" : "רוצה לתייר כאן 🚶"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DestinationView({
  dest,
  attractions: baseAttractions,
  insights = {},
  placeGroups = [],
  passes = [],
  coveredIds = [],
  isEditor = false,
  communityCount = 0,
  areas = [],
}: {
  dest: Destination;
  attractions: Attraction[];
  insights?: Record<number, Insight[]>;
  placeGroups?: { name: string; items: Insight[] }[];
  passes?: Pass[];
  coveredIds?: number[];
  isEditor?: boolean;
  communityCount?: number;
  areas?: AreaCard[];
}) {
  const covered = new Set(coveredIds);
  // Editor curation: optimistic overrides of the two ratings while the write to
  // editor_picks is in flight. Overlays onto the server data so the ⭐ badge,
  // sort, kids matching and the controls react instantly. Consumers never see
  // this UI. A rank of 'must' drives the effective must_see flag.
  const [ratingOverrides, setRatingOverrides] = useState<Record<number, { rank?: string | null; kids?: string | null }>>({});
  const attractions = useMemo(
    () => (Object.keys(ratingOverrides).length === 0
      ? baseAttractions
      : baseAttractions.map((a) => {
          const o = ratingOverrides[a.id];
          if (!o) return a;
          const rank = "rank" in o ? o.rank : a.editor_rank;
          const kids = "kids" in o ? o.kids : a.editor_kids;
          // Effective must-see overlay: a set rank drives it; clearing the rank
          // reverts to the raw OSM flag (matches the server per-attraction model).
          const must_see = "rank" in o ? (rank ? (rank === "must" ? 1 : 0) : (a.osm_must_see ?? 0)) : a.must_see;
          return { ...a, editor_rank: rank ?? null, editor_kids: kids ?? null, must_see };
        })),
    [baseAttractions, ratingOverrides]
  );
  // Lookup for the neighbourhood strip to list each area's attractions by id.
  const attrById = useMemo(() => new Map(attractions.map((a) => [a.id, a])), [attractions]);
  // Set one rating axis (click the active value again to clear it). Optimistic,
  // reverts on failure.
  const setRating = (a: Attraction, field: "rank" | "kids", value: string | null) => {
    const prev = field === "rank" ? a.editor_rank : a.editor_kids;
    const next = prev === value ? null : value;   // toggle off if re-picking the same
    setRatingOverrides((o) => ({ ...o, [a.id]: { ...o[a.id], [field]: next } }));
    fetch("/api/editor/pick", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination_id: dest.id, attraction_id: a.id, field, value: next }),
    })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
      .catch(() => setRatingOverrides((o) => ({ ...o, [a.id]: { ...o[a.id], [field]: prev } })));
  };
  // family_score is a family-friendliness metric — only surface it (the
  // "מומלץ למשפחות" filter, the score star) when the traveler has kids.
  // The profile is editable right here: the interest tiles are the same 3-state
  // control as the profile page, writing to profile.interests / profile.dislikes.
  const [profile] = useProfile();
  const isFamily = profile.kids.length > 0;
  // "solo" — a transient focus (not saved to the profile): show ONLY this topic.
  // Single-select. It's the 4th step of the tile cycle, after "לא מעוניין".
  const [soloInterest, setSoloInterest] = useState<string | null>(null);
  const [selectedOnly, setSelectedOnly] = useState(false);  // "הצג רק נבחרים" — mutually exclusive with solo
  const toggleSelectedOnly = () => { setSoloInterest(null); setSelectedOnly((v) => !v); };
  // How the attraction list renders: a compact LIST in the trip-page design language
  // (default — row → expands down, image on the right, info across) or image-top TILES.
  const [listView, setListView] = useState(true);
  // (The interest ✓/✕/solo cycler + editor were retired with the "הכל" mode;
  // soloInterest state stays as a harmless no-op the list filter still reads.)
  const [selected, setSelected] = useState<Attraction | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);  // card hover → grow its map marker
  const [query, setQuery] = useState("");
  const [showPlaces, setShowPlaces] = useState(false);
  const [showPasses, setShowPasses] = useState(false);
  const [mustOnly, setMustOnly] = useState(true);   // "רק אתרי חובה" — default ON
  const [flags, setFlags] = useState({
    free: false, indoor: false, top: false, withInsights: false,
  });
  const toggleFlag = (k: keyof typeof flags) =>
    setFlags((f) => ({ ...f, [k]: !f[k] }));
  // #13 — narrow the list to what's currently visible on the map.
  // Two ways in: "choose" (the default — pick an audience) and "short" (an audience
  // is chosen → the calibratable topic chips + one-tap build). The old "explore /
  // הכל" deep-editor mode was retired; its filters live next to the search now.
  const [audience, setAudience] = useState<Profile | null>(null);
  const [boosts, setBoosts] = useState<Set<string>>(new Set());
  // The primary action group lives on the "בשביל מי הטיול?" line; the fixed bottom
  // bar is only its scroll fallback — shown once this top group leaves the viewport.
  const topCtaRef = useRef<HTMLDivElement>(null);
  const [topCtaVisible, setTopCtaVisible] = useState(true);
  useEffect(() => {
    const el = topCtaRef.current;
    if (!el) return;
    const check = () => {
      const r = el.getBoundingClientRect();
      setTopCtaVisible(r.bottom > 0 && r.top < window.innerHeight);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, []);
  const [mapOnly, setMapOnly] = useState(false);
  const [bounds, setBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  // Desktop tags row: sort order + the "more filters" popover.
  const [sort, setSort] = useState<SortKey>("match");
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Per-city yes/maybe/no marks (the "city profile") + the build modal.
  const { create } = useTrips();
  const { choices, setChoice, setMany, clear } = useCitySelection(dest.id);
  // Selections persist across visits (by design) — so give a way to wipe them
  // all, not just the current view. Confirm first: it kills the whole city's
  // marks, including ones hidden by the active filters.
  const clearAllChoices = () => {
    const n = Object.keys(choices).length;
    if (window.confirm(`למחוק את כל ${n} הסימונים ששמרתם לעיר הזו (כולל מביקורים קודמים)?`)) {
      clear();
      setSelectedOnly(false);
    }
  };
  const [buildOpen, setBuildOpen] = useState(false);
  // mode 3: "build for <audience>" anchors on the short path, ignoring any
  // stale per-city marks; the explore-mode bottom bar builds from marks.
  const [buildDays, setBuildDays] = useState(4);
  const [buildRadius, setBuildRadius] = useState(1);
  const [buildPace, setBuildPace] = useState<Pace>("בינוני");
  const [building, setBuilding] = useState(false);
  // Open the build modal seeded with the traveler's saved pace.
  const openBuild = () => { setBuildPace((profile.pace as Pace) ?? "בינוני"); setBuildOpen(true); };
  const PAGE = 200;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const yesCount = Object.values(choices).filter((c) => c === "yes").length;
  // Likes are optional refinements now (the governed build works from audience +
  // topics alone), so building is always available once an audience is chosen. The
  // progress track just shows how many likes tune the trip toward a soft target.
  const minPicks = Math.min(7, attractions.length || 7);
  // Capacity follows the chosen pace, so the estimate matches what the builder
  // will actually schedule (רגוע ~4/day, בינוני ~5, אינטנסיבי ~6).
  const buildCapacity = buildDays * PACE_PER_DAY[buildPace];
  const overPick = yesCount > buildCapacity;

  const router = useRouter();
  const taste = useMemo(() => deriveTaste(profile), [profile]);
  const cityTasteTagged = useMemo(() => attractions.some((a) => a.taste_tags?.length), [attractions]);

  // The visible list: must-see by default (the "רק אתרי חובה" toggle), narrowed
  // to the active interest tile + the popover filters. Search runs over the
  // whole loaded city.
  const filtered = useMemo(
    () =>
      attractions.filter((a) => {
        // "הצג רק נבחרים" overrides the other filters: show exactly the places
        // the traveler marked (כן/אולי), so a lone pick is always findable.
        if (selectedOnly) return choices[a.id] === "yes";
        // solo focus: show ALL of the focused topic (matching its tile count),
        // still respecting search / map / popover flags below. It deliberately
        // bypasses the must-see toggle — otherwise soloing "אוכל 1" could show 0
        // when that one place isn't an editor pick. Likes/dislikes are ignored.
        if (soloInterest) { if (!matchesInterest(a, soloInterest)) return false; }
        else {
          // ✕ interests hide entirely — e.g. "ילדים" on a couples' trip removes
          // every kid place, not even dimmed. An explicit כן/אולי keeps it.
          if (!choices[a.id] && profile.dislikes.some((it) => matchesInterest(a, it))) return false;
          // "רק אתרי חובה" narrows the BROWSE — but an active search must find any
          // place by name, not only must-sees, so a query bypasses the must-see gate.
          if (mustOnly && !query && a.must_see !== 1) return false;
        }
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
    [attractions, mustOnly, query, flags, insights, selectedOnly, choices, profile.dislikes, soloInterest]
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
  // The audience topic chips ("כיילו") — a taste tilt that LEADS matching places
  // within the matched set (they no longer hard-filter to a curated 24).
  const boostMatch = useMemo(() => {
    if (!boosts.size) return null;
    const w: Record<string, number> = {};
    for (const k of boosts) for (const t of (INTEREST_TASTE[k] ?? [])) w[t] = (w[t] ?? 0) + 1;
    return (a: Attraction) => tasteScore(a.taste_tags, w) > 0 || coarseFits(a.category, a.subcategory, [...boosts]);
  }, [boosts]);

  const { sortedItems, dimmedIds, matchedIds } = useMemo(() => {
    const img = (a: Attraction) => (a.image_url ? 1 : 0);
    // Editor importance tier: "ממש לא" floors it (0); effective must-see leads
    // (4); "אולי" is a real mid boost (3); everything else normal (2).
    const tier = (a: Attraction) =>
      a.editor_rank === "no" ? 0 : a.must_see === 1 ? 4 : a.editor_rank === "maybe" ? 3 : 2;
    // Within a tier, a chosen topic chip leads (the audience-flow calibration).
    const boostTier = (a: Attraction) => (boostMatch && boostMatch(a) ? 1 : 0);
    const within = (a: Attraction, b: Attraction) => {
      if (sort === "name") return (a.name_he || a.name_en).localeCompare(b.name_he || b.name_en, "he");
      if (sort === "match" && cityTasteTagged) return tasteScore(b.taste_tags, taste) - tasteScore(a.taste_tags, taste);
      return (b.family_score ?? 0) - (a.family_score ?? 0);
    };
    const cmp = (a: Attraction, b: Attraction) =>
      tier(b) - tier(a) || boostTier(b) - boostTier(a) || img(b) - img(a) || within(a, b);
    // "matched" = fits the chosen audience (couples/friends or families) and isn't
    // an explicit ✕-dislike. What doesn't fit drops BELOW the divider — still fully
    // markable, never hidden and never greyed.
    // "matched" = fits the chosen audience and isn't an explicit ✕-dislike. The
    // topic chips (boosts) only re-order within the matched set (via boostTier above),
    // they don't narrow it — everything stays visible, the off-fit tail below the divider.
    const audienceOk = (a: Attraction) => !audience || audienceFit(a, audience) >= AUDIENCE_FIT_FLOOR;
    const notDisliked = (a: Attraction) => !profile.dislikes.some((it) => matchesInterest(a, it));
    const isMatch = (a: Attraction) => audienceOk(a) && notDisliked(a);
    const matched: Attraction[] = [], dimmed: Attraction[] = [];
    for (const a of listItems) ((selectedOnly || soloInterest || isMatch(a)) ? matched : dimmed).push(a);
    matched.sort(cmp); dimmed.sort(cmp);
    return { sortedItems: [...matched, ...dimmed], dimmedIds: new Set(dimmed.map((a) => a.id)), matchedIds: matched.map((a) => a.id) };
  }, [listItems, sort, cityTasteTagged, taste, profile.dislikes, selectedOnly, soloInterest, audience, boostMatch]);

  // Paginate: show PAGE at a time; reset to page 1 on any change.
  useEffect(() => { setVisibleCount(PAGE); }, [query, mustOnly, flags, mapOnly, sort, selectedOnly, soloInterest, profile.interests, profile.dislikes, audience, boosts]);
  // Never leave the traveler stranded in an empty "selected only" view.
  useEffect(() => { if (selectedOnly && yesCount === 0) setSelectedOnly(false); }, [selectedOnly, yesCount]);
  const visible = sortedItems.slice(0, visibleCount);
  const firstDimId = visible.find((a) => dimmedIds.has(a.id))?.id;
  // One unified list in every mode — audience is folded into the matched split
  // above (no separate curated screen).
  const displayItems = visible;
  const mode: "choose" | "short" = audience ? "short" : "choose";
  const belowLabel = audience
    ? `פחות מתאים ל${PROFILE_HE[audience]} — אפשר בכל זאת לסמן`
    : "מחוץ להעדפות שלכם — אפשר בכל זאת לסמן";
  // Governing topic chips this CITY can actually deliver — only offer a chip with
  // ≥2 matching places (so niche topics like חופים/פארקי שעשועים hide where the
  // city has none). Keeps the audience flow honest per destination.
  const govInterests = useMemo(
    () => GOVERNING_INTERESTS.filter((it) => attractions.filter((a) => matchesInterest(a, it.key)).length >= 2),
    [attractions]);
  // Bulk marks over the matched set (the primary view).
  const viewIds = matchedIds;
  const viewSelected = viewIds.filter((id) => choices[id]).length;

  // The traveler's picks with coordinates — highlighted on the map, and framed
  // when they tap "מקד את הנבחרים" (bumps a nonce the map watches).
  const pickedAttractions = useMemo(
    () => attractions.filter((a) => choices[a.id] === "yes" && a.lat != null && a.lng != null),
    [attractions, choices]
  );
  const [fitNonce, setFitNonce] = useState(0);
  const [areaFocus, setAreaFocus] = useState<{ lat: number; lng: number; n: number } | null>(null);
  // Neighbourhoods chosen to tour — a SEPARATE selection from the attraction
  // yes/maybe marks, so picking an area never silently floods the attraction picks.
  const [chosenAreas, setChosenAreas] = useState<Set<number>>(() => new Set());
  // Members of a CHOSEN neighbourhood are guaranteed into the trip regardless of
  // likes → we badge them "בשכונה שבחרת" so an un-liked one doesn't read as "forgot".
  const chosenAreaMemberIds = useMemo(
    () => new Set(areas.filter((a) => chosenAreas.has(a.id)).flatMap((a) => a.member_ids)),
    [areas, chosenAreas]);
  const toggleArea = (id: number) => setChosenAreas((s) => {
    const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  // Mobile: the 240px sticky map strip eats most of the screen — let the
  // traveler collapse it. Desktop always shows the map rail. A window resize
  // event after the toggle makes Leaflet re-measure its container.
  const [mapOpen, setMapOpen] = useState(true);
  const toggleMap = () => {
    setMapOpen((v) => !v);
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 350);
  };

  // How many must-see places are actually VISIBLE in the list — i.e. must-see,
  // not hidden by a ✕ interest (an explicit כן/אולי keeps it), within the same
  // search/map/popover scope. Deliberately toggle-independent, and it counts the
  // dimmed likes-tail too (which the list still shows), so the chip number
  // matches the must-see cards on screen.
  const mustSeeCount = useMemo(() => {
    const q = query.toLowerCase();
    return attractions.filter((a) => {
      if (a.must_see !== 1) return false;
      if (!choices[a.id] && profile.dislikes.some((it) => matchesInterest(a, it))) return false;
      if (flags.free && a.cost_level !== 0) return false;
      if (flags.indoor && !(a.indoor_outdoor === "indoor" || a.indoor_outdoor === "both")) return false;
      if (flags.top && (a.family_score ?? 0) < 8) return false;
      if (flags.withInsights && !insights[a.id]?.length) return false;
      if (mapOnly && bounds && !(a.lat != null && a.lng != null &&
        a.lat <= bounds.north && a.lat >= bounds.south && a.lng <= bounds.east && a.lng >= bounds.west)) return false;
      if (q && !`${a.name_he ?? ""} ${a.name_en} ${descriptor(a)}`.toLowerCase().includes(q)) return false;
      return true;
    }).length;
  }, [attractions, choices, profile.dislikes, flags, insights, mapOnly, bounds, query]);

  // Active popover filters (for the "פילטרים · N" badge).
  const moreFilterCount = (flags.free ? 1 : 0) + (flags.indoor ? 1 : 0) + (flags.withInsights ? 1 : 0) + (mapOnly ? 1 : 0);

  // Interest-tile counts (ALL interests are always shown so they double as the
  // profile editor) + popover filter counts. A tile's count is a STABLE FACT —
  // how many places of that interest the city holds in the current search/map
  // scope. It deliberately ignores the "רק אתרי חובה" toggle: that's an
  // additional filter on the grid, not a preference, so it must not rewrite
  // "ספורט 4" to "ספורט 0" just because none of those 4 are editor-picks.
  const { flagCount } = useMemo(() => {
    const q = query.toLowerCase();
    const mQ = (a: Attraction) => !q || `${a.name_he ?? ""} ${a.name_en} ${descriptor(a)}`.toLowerCase().includes(q);
    const mMap = (a: Attraction) => !mapOnly || !bounds ||
      (a.lat != null && a.lng != null && a.lat <= bounds.north && a.lat >= bounds.south && a.lng <= bounds.east && a.lng >= bounds.west);
    const mFree = (a: Attraction) => a.cost_level === 0;
    const mIndoor = (a: Attraction) => a.indoor_outdoor === "indoor" || a.indoor_outdoor === "both";
    const mTop = (a: Attraction) => (a.family_score ?? 0) >= 8;
    const mIns = (a: Attraction) => !!insights[a.id]?.length;
    const pop = (a: Attraction) => (!flags.free || mFree(a)) && (!flags.indoor || mIndoor(a)) && (!flags.top || mTop(a)) && (!flags.withInsights || mIns(a));
    const base = (a: Attraction) => mQ(a) && mMap(a) && pop(a);
    const tiles = ALL_INTERESTS.map((it) => ({ key: it, count: attractions.filter((a) => base(a) && matchesInterest(a, it)).length }));
    const flagCount = {
      free: attractions.filter((a) => mQ(a) && mMap(a) && mFree(a)).length,
      indoor: attractions.filter((a) => mQ(a) && mMap(a) && mIndoor(a)).length,
      top: attractions.filter((a) => mQ(a) && mMap(a) && mTop(a)).length,
      withInsights: attractions.filter((a) => mQ(a) && mMap(a) && mIns(a)).length,
    } as Record<keyof typeof flags, number>;
    return { interestTiles: tiles, flagCount };
  }, [attractions, query, mapOnly, bounds, flags, insights]);

  // Build a trip from the city marks (yes = anchors, no = excluded; unmarked
  // places enter only if they are must-sees or sit in a chosen neighbourhood).
  // Empty selection is fine — the builder falls back to the profile-matched
  // must-sees. Days + distance come from the modal. We hand off to the trip page
  // with ?build=1 so it starts building immediately.
  function buildTrip() {
    const yes: number[] = [], no: number[] = [];
    for (const [id, c] of Object.entries(choices)) {
      (c === "yes" ? yes : no).push(Number(id));
    }
    // The ❤ likes are now ADDITIVE refinements on the governed build (Layer 4):
    // they always travel to the server, and route.ts folds them into the
    // interest/audience/neighbourhood reservation (guaranteed in, but governance —
    // reservation, museum cap, additive areas — stays on). Only a pure explore
    // build with NO audience/areas falls back to the old marks-drive-everything path.
    const useMarks = true;
    const yesFinal = useMarks ? yes : [];
    const noFinal = useMarks ? no : [];
    setBuilding(true);
    // Neighbourhoods the traveller chose to tour → one guaranteed day each.
    const chosenAreaList = areas.filter((a) => chosenAreas.has(a.id));
    const chosenAreaGroups = chosenAreaList.map((a) => a.member_ids);
    const chosenAreaIds = chosenAreaList.map((a) => a.id);
    // Streets are no longer hand-picked — the server auto-includes a chosen area's
    // streets + (for the "אדריכלות ורחובות" interest) the city's top streets.
    // The chosen interest chips GOVERN the build. In the short/couples flow they live
    // in `boosts` (which the couple actually clicks); in explore mode they're the
    // profile interests. Fold their taste weights into the build taste (a couple never
    // sets profile.interests, so without this the chips wouldn't reach the engine), and
    // pass the raw keys as `interests` for the route's coarse fallback + reservation.
    const chosenInterests = boosts.size ? [...boosts] : (profile.interests ?? []);
    const buildTaste = { ...taste };
    if (boosts.size) for (const k of boosts) for (const t of (INTEREST_TASTE[k] ?? [])) buildTaste[t] = (buildTaste[t] ?? 0) + 3;
    const trip = create({
      title: `טיול ל${dest.city_he || dest.city}`,
      mode: "preferences",
      city: dest.city,
      cityHe: dest.city_he || dest.city,
      country: dest.country,
      destinationId: dest.id,
      days: buildDays,
      month: new Date().getMonth() + 1,   // a default season; exact dates are set on the trip page
      profile: { ...profile, pace: buildPace, taste: buildTaste, dailyDriveHours: RADIUS_HOURS[buildRadius] },
      ...(chosenInterests.length ? { interests: chosenInterests } : {}),
      ...(audience ? { audience } : {}),
      ...(yesFinal.length || noFinal.length ? { selection: { yes: yesFinal, no: noFinal } } : {}),
      ...(chosenAreaGroups.length ? { areaGroups: chosenAreaGroups, areaIds: chosenAreaIds } : {}),
    });
    router.push(`/trip/${trip.id}?build=1`);
  }

  return (
    <main className="mx-auto w-full max-w-[440px] pb-28 lg:max-w-none lg:pb-20">
      {isEditor && (
        <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-[#3d2c0a] px-4 py-1.5 text-center text-[12.5px] font-medium text-[var(--amber-fill)]">
          <span>✎ מצב עורך — דרגו כל אטרקציה: חשיבות (חובה / אולי / ממש לא) והתאמה לילדים. השינויים נשמרים מיד.</span>
        </div>
      )}
      {/* compact card hero — a small landscape thumbnail + flag/city + a
          personalized CTA (the trip page's hero language), so the map + list
          are reachable right away */}
      <header className="rise px-5 pt-3 pb-2.5 lg:px-8 lg:pt-4 lg:pb-3">
        <div className="mx-auto max-w-[1600px]">
          {/* the top city section sits directly on the cream page background (no
              white card). Structured like the TRIP header: a horizontal identity
              (breadcrumb | title · places · badges) with the destination image on
              the far right spanning it, and the interests as a full-width row
              below — no divider between the image and the info to its left. */}
          <div className="p-3.5 lg:relative lg:p-4">
            {/* destination image — far right, spans the header (like the trip) */}
            <div className="hidden overflow-hidden rounded-[var(--radius-sm)] lg:absolute lg:top-4 lg:block lg:h-[105px] lg:w-[160px]"
                 style={{ insetInlineStart: "16px" }}>
              <CityPoster destinationId={dest.id} cityHe={dest.city_he || dest.city}
                orientation="landscape" position="50% 45%" className="absolute inset-0 size-full" />
            </div>
            {mode === "short" && yesCount === 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[var(--border)] pb-3 text-[15px] text-[var(--text-2)] lg:pr-[176px]">
                <span className="text-[16px] font-bold text-[var(--brand-ink)]">איך בונים טיול?</span>
                <span className="inline-flex items-center gap-1.5"><b className="grid size-[20px] place-items-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-white">1</b> בחרו נושאים שאתם אוהבים</span>
                <ChevronRight size={16} className="text-[var(--text-3)]" />
                <span className="inline-flex items-center gap-1.5"><b className="grid size-[20px] place-items-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-white">2</b> תנו ❤ לייק לאטרקציות שאהבתם</span>
                <ChevronRight size={16} className="text-[var(--text-3)]" />
                <span className="inline-flex items-center gap-1.5"><b className="grid size-[20px] place-items-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-white">3</b> נרכיב לכם את הטיול</span>
              </div>
            )}

            {/* identity row — breadcrumb | title · places · badges, all inline */}
            <div className="flex flex-col gap-3 lg:pr-[176px]">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Link href="/" className="eyebrow inline-flex items-center gap-1 text-[var(--text-2)]">
                  <ChevronRight size={14} /> בית
                </Link>
                <span className="h-3.5 w-px bg-[var(--border)]" />
                <h1 className="serif flex items-center gap-1.5 text-[20px] font-bold leading-tight lg:text-[22px]">
                  <span className="text-[0.72em]">{countryFlag(dest.country)}</span>
                  {dest.city_he || dest.city}
                </h1>
                <span className="text-[13px] font-semibold text-[var(--text-2)]">
                  · {dest.attraction_count.toLocaleString("he")} מקומות לגלות בעיר
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--brand-ink)]">
                  <Sparkles size={11} /> מותאם לפרופיל שלכם
                </span>
                {passes.length > 0 && (
                  <button onClick={() => setShowPasses((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--brand)] bg-[var(--surface)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-soft)]">
                    💳 כרטיס חוסך כסף {showPasses ? "▴" : "▾"}
                  </button>
                )}
                {communityCount > 0 && (
                  <Link href={`/destination/${dest.id}/trips`}
                    className="inline-flex items-center gap-1 rounded-full border border-[#ff5a5f]/40 bg-[#ff5a5f]/8 px-2 py-0.5 text-[11.5px] font-medium text-[#d63d42] transition hover:bg-[#ff5a5f]/15">
                    ❤️ {communityCount} טיולים של מטיילים
                  </Link>
                )}
              </div>

              {/* audience tabs — pick who the trip is for (families / couples&friends).
                  The primary actions (show-selected · clear · build) sit at the FAR
                  side of this same line — disabled until an audience is chosen. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-semibold text-[var(--text-2)]">בשביל מי הטיול?</span>
                {PROFILES.map((p) => {
                  const on = audience === p;
                  return (
                    <button key={p} onClick={() => { setAudience(on ? null : p); setBoosts(new Set()); }}
                      className="rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold transition"
                      style={{ background: on ? "var(--brand)" : "var(--surface)", color: on ? "#fff" : "var(--text-2)",
                               borderColor: on ? "var(--brand)" : "var(--border)" }}>
                      {PROFILE_EMOJI[p]} {PROFILE_HE[p]}
                    </button>
                  );
                })}
                <div ref={topCtaRef} className="flex items-center gap-2 ms-auto">
                  <button onClick={toggleSelectedOnly} disabled={!audience || yesCount === 0}
                    className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: selectedOnly ? "var(--brand)" : "var(--surface)",
                             color: selectedOnly ? "#fff" : "var(--brand-ink)", borderColor: "var(--brand)" }}>
                    {selectedOnly ? "הצג הכל" : `הצג נבחרים${yesCount ? ` · ${yesCount}` : ""}`}
                  </button>
                  <button onClick={clearAllChoices} disabled={!audience || yesCount === 0}
                    title="נקה את כל הסימונים ששמורים לעיר"
                    className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-[12.5px] text-[var(--text-3)] transition hover:border-[#c0453f] hover:text-[#c0453f] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-3)]">
                    <X size={13} /> נקה
                  </button>
                  {/* THE primary action — accent (terracotta) so it stands apart from
                      every green control on the page as the one thing to do next. */}
                  <button onClick={() => openBuild()} disabled={!audience}
                    className="flex items-center gap-1.5 rounded-full px-5 py-1.5 text-[13.5px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed"
                    style={audience
                      ? { background: "var(--accent)", boxShadow: "0 4px 12px rgba(198,79,38,.28)" }
                      : { background: "var(--surface-2)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                    <Sparkles size={15} /> בנו לי טיול{yesCount ? ` · ${yesCount}` : ""}
                  </button>
                </div>
              </div>

              {/* short mode — taste calibration + one-tap build, transparent (no card) */}
              {mode === "short" && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-[var(--text-3)]"><b className="text-[var(--text-2)]">{matchedIds.length}</b> מקומות שמתאימים ל{PROFILE_HE[audience!]} · כיילו:</span>
                    {govInterests.map((it) => {
                      const on = boosts.has(it.key);
                      return (
                        <button key={it.key}
                          onClick={() => setBoosts((s) => { const n = new Set(s); if (n.has(it.key)) n.delete(it.key); else n.add(it.key); return n; })}
                          className="rounded-full border px-3 py-1 text-[12.5px] font-medium transition"
                          style={{ background: on ? "var(--text)" : "var(--surface)", color: on ? "#fff" : "var(--text-2)",
                                   borderColor: on ? "var(--text)" : "var(--border)" }}>
                          {it.emoji} {it.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {mode === "choose" && (
                <p className="text-[13px] text-[var(--text-3)]">בחרו למי הטיול — ונראה לכם את המקומות שהכי אהובים על אנשים כמוכם.</p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* headline neighbourhoods — first-class experiences above the attractions */}
      <NeighbourhoodStrip areas={areas} chosenIds={chosenAreas} attrById={attrById}
        onFocus={(a) => { setAreaFocus({ lat: a.lat, lng: a.lng, n: Date.now() }); if (!mapOpen) setMapOpen(true); }}
        onToggle={toggleArea} />

      {/* (The manual "רחובות מומלצים" picker was removed — streets now enter
          AUTOMATICALLY: a chosen neighbourhood pulls its own streets, and the
          "אדריכלות ורחובות" interest pulls the city's top streets. No street chore.) */}

      {/* the show/clear/build controls moved onto the "בשביל מי הטיול?" line (and the
          fixed bottom bar on scroll); only the "showing selected" hint stays here. */}
      {selectedOnly && yesCount > 0 && (
        <div className="mx-auto max-w-[1600px] px-5 pt-3 lg:px-8">
          <p className="text-[12px] text-[var(--text-3)]">מציג רק את {yesCount} המקומות שסימנתם — לחצו שוב על 👍 בכרטיס כדי להסיר אותו.</p>
        </div>
      )}

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

      {/* (The old explore-only sticky toolbar was retired — search + sort + filters
          now live in the always-visible toolbar just above the list, in every mode.) */}

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

      <div className={`lg:flex lg:items-start lg:pe-8 ${mode === "choose" ? "hidden" : ""}`}>
        {/* map — a narrow sticky rail on desktop; full-width strip on mobile */}
        <div className={`relative sticky top-0 z-10 w-full overflow-hidden border-[var(--border)] transition-[height] duration-300 ${mapOpen ? "h-[240px] border-y" : "h-0"} lg:order-2 lg:!h-[calc(100dvh-164px)] lg:top-[164px] lg:w-[380px] lg:shrink-0 lg:border-y-0 lg:border-s`}>
          <MapClient attractions={displayItems} center={[dest.lat, dest.lng]} selected={selected}
            picks={pickedAttractions} fitNonce={fitNonce} onBounds={setBounds} hoveredId={hoveredId} focus={areaFocus} />
          {pickedAttractions.length > 0 && (
            <button onClick={() => setFitNonce((n) => n + 1)}
              className="absolute left-1/2 top-3 z-[1000] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--brand)] bg-[var(--surface)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--brand-ink)] shadow-[var(--shadow)] transition hover:bg-[var(--brand-soft)]">
              <MapPin size={14} /> מקד את הנבחרים · {pickedAttractions.length}
            </button>
          )}
          {/* mobile: collapse the map to free the screen for the cards */}
          <button onClick={toggleMap}
            className="absolute bottom-2 left-2 z-[1000] rounded-full bg-black/55 px-3 py-1 text-[12.5px] font-medium text-white shadow-sm backdrop-blur-sm lg:hidden">
            הסתר מפה ▲
          </button>
        </div>

        {/* attraction cards — a grid on desktop, single column on mobile */}
        <section id="picks" className="scroll-mt-[120px] px-5 lg:order-1 lg:min-w-0 lg:flex-1 lg:px-8 lg:pb-16">
          {/* (retired mobile filter header — the always-visible toolbar below now
              serves every breakpoint.) */}
          <div className="hidden">
            <div className="mb-3 flex items-center gap-2.5 border-b border-[var(--border)] pb-2">
              <span className="serif shrink-0 text-[16px] font-bold text-[var(--text)]">{dest.city_he || dest.city}</span>
              <span className="h-4 w-px shrink-0 bg-[var(--border)]" />
              <Search size={16} className="shrink-0 text-[var(--text-3)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש אטרקציה…"
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]" />
            </div>
            <div className="flex flex-wrap gap-2">
              {!mapOpen && (
                <button onClick={toggleMap}
                  className="rounded-full border border-[var(--brand)] bg-[var(--surface)] px-3 py-1.5 text-[13.5px] font-medium text-[var(--brand-ink)]">
                  🗺️ הצג מפה ▾
                </button>
              )}
              {!soloInterest && !selectedOnly && (
                <button onClick={() => setMustOnly((v) => !v)}
                  className="rounded-full px-3 py-1.5 text-[13.5px] font-medium transition"
                  style={{ background: mustOnly ? "var(--brand)" : "var(--surface)",
                           color: mustOnly ? "#fff" : "var(--text-2)", border: `1px solid ${mustOnly ? "var(--brand)" : "var(--border)"}` }}>
                  ⭐ אתרי חובה <span className="opacity-70">{mustSeeCount}</span>
                </button>
              )}
              {([["free", "חינם"], ["indoor", "מקורה"]] as [keyof typeof flags, string][]).map(([k, label]) => (
                <button key={k} onClick={() => toggleFlag(k)}
                  className="rounded-full px-3 py-1.5 text-[13.5px] transition"
                  style={{ background: flags[k] ? "var(--accent)" : "var(--surface)", color: flags[k] ? "#fff" : "var(--text-2)",
                           border: `1px solid ${flags[k] ? "var(--accent)" : "var(--border)"}` }}>{label} <span className="opacity-60">{flagCount[k]}</span></button>
              ))}
              <button onClick={() => setMapOnly((v) => !v)}
                className="rounded-full px-3 py-1.5 text-[13.5px] transition"
                style={{ background: mapOnly ? "var(--brand)" : "var(--surface)", color: mapOnly ? "#fff" : "var(--text-2)",
                         border: `1px solid ${mapOnly ? "var(--brand)" : "var(--border)"}` }}>📍 על המפה</button>
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

          {/* toolbar above the list — ALWAYS visible (the old explore-only sticky
              toolbar was retired). Live search + sort + filters on one row; the
              "רק אתרי חובה" tag + view toggle on the next. */}
          <div className="flex flex-wrap items-center gap-2 pt-3">
            {/* live search — filters as you type; ✕ clears */}
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
              <Search size={16} className="shrink-0 text-[var(--text-3)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש אטרקציה, שכונה או סוג מקום…"
                className="flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-[var(--text-3)]" />
              {query && (
                <button onClick={() => setQuery("")} aria-label="נקה חיפוש" className="shrink-0 text-[var(--text-3)] transition hover:text-[var(--text)]">
                  <X size={16} />
                </button>
              )}
            </div>
            {/* sort */}
            <div className="relative shrink-0">
              <button onClick={() => { setSortOpen((o) => !o); setFiltersOpen(false); }}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13.5px] text-[var(--text-2)]">
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
            {/* filters popover */}
            <div className="relative shrink-0">
              <button onClick={() => { setFiltersOpen((o) => !o); setSortOpen(false); }}
                className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13.5px] transition"
                style={{ borderColor: moreFilterCount ? "var(--brand)" : "var(--border)",
                         background: moreFilterCount ? "var(--brand-soft)" : "var(--surface)",
                         color: moreFilterCount ? "var(--brand-ink)" : "var(--text-2)" }}>
                <SlidersHorizontal size={15} /> פילטרים{moreFilterCount ? ` · ${moreFilterCount}` : ""}
                <ChevronDown size={14} className={filtersOpen ? "rotate-180" : ""} />
              </button>
              {filtersOpen && (
                <div className="absolute left-0 z-40 mt-1 w-60 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow)]">
                  {([["free", "חינם"], ["indoor", "מקורה"],
                     ...(isFamily ? [["top", "מומלץ למשפחות"]] : []),
                     ["withInsights", "💬 עם תובנות מטיילים"]] as [keyof typeof flags, string][]).map(([k, label]) => (
                    <button key={k} onClick={() => toggleFlag(k)}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-right text-[13.5px] transition hover:bg-[var(--surface-2)]">
                      <span style={{ color: flags[k] ? "var(--brand-ink)" : "var(--text-2)", fontWeight: flags[k] ? 600 : 400 }}>
                        {label} <span className="text-[var(--text-3)]">{flagCount[k]}</span>
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
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {!soloInterest && !selectedOnly ? (
              <button onClick={() => setMustOnly((v) => !v)} aria-pressed={mustOnly}
                className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition"
                style={{ background: mustOnly ? "var(--brand)" : "var(--surface)", color: mustOnly ? "#fff" : "var(--text-2)",
                         borderColor: mustOnly ? "var(--brand)" : "var(--border)" }}>
                <span>⭐ רק אתרי חובה</span>
                <span className={mustOnly ? "text-white/80" : "text-[var(--text-3)]"}>{mustSeeCount}</span>
                {mustOnly && <Check size={14} />}
              </button>
            ) : <span />}
            <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5 text-[13px] font-medium">
              <button onClick={() => setListView(false)} aria-pressed={!listView}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 transition"
                style={{ background: !listView ? "var(--brand)" : "transparent", color: !listView ? "#fff" : "var(--text-2)" }}>
                <LayoutGrid size={14} /> משבצות
              </button>
              <button onClick={() => setListView(true)} aria-pressed={listView}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 transition"
                style={{ background: listView ? "var(--brand)" : "transparent", color: listView ? "#fff" : "var(--text-2)" }}>
                <List size={14} /> רשימה
              </button>
            </div>
          </div>

          {/* Transparency line — kills the "must I like everything?" worry: the trip
              is composed automatically; ❤ is an optional "make sure this one's in". */}
          <p className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2 text-[12.5px] leading-relaxed text-[var(--text-2)]">
            הטיול נבנה אוטומטית מהנושאים, השכונות שבחרתם ואתרי החובה <span className="text-[var(--accent-ink)]">⭐</span> — הם נכנסים גם בלי סימון.
            {" "}<span className="inline-flex items-center gap-0.5 font-medium text-[var(--brand-ink)]"><Heart size={12} fill="currentColor" /> הלייק</span> הוא רק כדי לוודא שמקום מסוים ייכנס — לא חובה.
          </p>

          {/* LIST view — compact rows in the trip-page design language; a row expands
              DOWN with the image on the right and all its info laid out across. */}
          {listView ? (
          <div className="flex flex-col gap-2.5 pt-3">
            {displayItems.map((a) => {
              const isSel = selected?.id === a.id;
              const cost = a.cost_level != null ? COST_HE[a.cost_level] : null;
              const dur = durationHe(a.duration_minutes);
              const cat = mergeCat(a.category);
              const insList = insights[a.id] ?? [];
              const tip = insList[0]?.text_he || a.tips_he;
              const choice = choices[a.id];
              return (
                <Fragment key={a.id}>
                {a.id === firstDimId && (
                  <div className="mt-1 flex items-center gap-3 pb-1 pt-2">
                    <div className="h-px flex-1 bg-[var(--border)]" />
                    <span className="shrink-0 text-[12.5px] text-[var(--text-3)]">{belowLabel}</span>
                    <div className="h-px flex-1 bg-[var(--border)]" />
                  </div>
                )}
                <div onMouseEnter={() => setHoveredId(a.id)} onMouseLeave={() => setHoveredId((h) => (h === a.id ? null : h))}
                  className="overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface)] shadow-[var(--shadow)] transition"
                  style={{ borderColor: choice === "yes" || isSel ? "var(--brand)" : "var(--border)" }}>
                  {/* header row — click to expand + fly the map. The heart lives on
                      the frame (its own button); the tagline fills the empty space
                      to the LEFT of the name (RTL) instead of sitting inside the body. */}
                  <div className="flex items-stretch">
                    <button onClick={() => setSelected(isSel ? null : a)} className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-right">
                      {a.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={bigImage(a.image_url, 200)} alt="" loading="lazy" className="size-14 shrink-0 rounded-[10px] object-cover" />
                      ) : (
                        <div className="grid size-14 shrink-0 place-items-center rounded-[10px]" style={{ background: `color-mix(in srgb, ${catColor(cat)} 16%, var(--surface-2))` }}>
                          <MapPin size={20} style={{ color: catColor(cat) }} />
                        </div>
                      )}
                      <div className="min-w-0 shrink-0 max-w-[52%]">
                        <p className="serif truncate text-[16px] font-bold leading-tight">
                          {a.must_see === 1 && <span className="ml-1 align-middle text-[var(--accent-ink)]">⭐</span>}
                          {a.name_he || a.name_en}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-[var(--text-3)]">
                          <span>{CAT_HE[cat] ?? a.category}</span>
                          {dur && <span>🕐 {dur}</span>}
                          {cost && <span className="text-[var(--brand-ink)]">{cost}</span>}
                          {covered.has(a.id) && <span className="text-[var(--brand-ink)]">💳 בכרטיס</span>}
                          {chosenAreaMemberIds.has(a.id) && a.must_see !== 1 && <span className="text-[var(--brand-ink)]">✓ בשכונה שבחרת</span>}
                        </div>
                      </div>
                      {a.tagline_he && (
                        <p className="hidden min-w-0 flex-1 truncate text-[13.5px] italic text-[var(--text-3)] sm:block">{a.tagline_he}</p>
                      )}
                      <ChevronDown size={18} className={`ms-auto shrink-0 text-[var(--text-3)] transition-transform ${isSel ? "rotate-180" : ""}`} />
                    </button>
                    <HeartToggle liked={choice === "yes"} onClick={() => setChoice(a.id, "yes")} />
                  </div>
                  {/* expand — image on the RIGHT (first child, RTL); only the detail
                      text + when-to-go + dress remain (tagline, tip source & official
                      link were pulled out / dropped to keep this lean). */}
                  {isSel && (
                    <div className="border-t border-[var(--border)] p-3">
                      <div className="flex flex-col gap-3 sm:flex-row">
                        {a.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={bigImage(a.image_url, 640)} alt="" loading="lazy"
                            onError={(e) => { const t = e.currentTarget; if (a.image_url && t.src !== a.image_url) t.src = a.image_url; }}
                            className="aspect-[4/3] w-full shrink-0 rounded-[10px] object-cover sm:w-[38%] sm:self-start" />
                        )}
                        <div className="min-w-0 flex-1">
                          {a.tagline_he && <p className="mb-1.5 text-[14px] italic text-[var(--text-2)] sm:hidden">{a.tagline_he}</p>}
                          {a.description_he && <p className="text-[13.5px] leading-relaxed text-[var(--text-2)]">{a.description_he}</p>}
                          {tip && <p className="mt-1.5 flex items-start gap-1 text-[13px] leading-snug text-[var(--brand-ink)]"><span className="shrink-0">💡</span><span>טיפ מטיילים: {tip}</span></p>}
                          {insList.length > 1 && (
                            <div className="mt-1.5 flex flex-col gap-1">
                              {insList.slice(1).map((ins) => (
                                <p key={ins.id} className="flex items-start gap-1 text-[12.5px] leading-snug text-[var(--brand-ink)]"><span className="shrink-0">{KIND_ICON[ins.kind] ?? "💬"}</span><span>{ins.text_he}</span></p>
                              ))}
                            </div>
                          )}
                          {(a.best_time_he || a.dress_he) && (
                            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[var(--text-2)]">
                              {a.best_time_he && <span><span className="text-[var(--text-3)]">מתי: </span>{a.best_time_he}</span>}
                              {a.dress_he && <span><span className="text-[var(--text-3)]">לבוש: </span>{a.dress_he}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* editor rating rows + full-width like are intentionally hidden in
                      LIST mode — the heart on the frame replaces the strip. */}
                </div>
                </Fragment>
              );
            })}
          </div>
          ) : (
          <div className="grid grid-cols-1 gap-4 pt-3 sm:grid-cols-2 lg:pt-4 xl:grid-cols-3">
            {displayItems.map((a) => {
              const isSel = selected?.id === a.id;
              const cost = a.cost_level != null ? COST_HE[a.cost_level] : null;
              const dur = durationHe(a.duration_minutes);
              const cat = mergeCat(a.category);
              const insList = insights[a.id] ?? [];
              const tip = insList[0]?.text_he || a.tips_he;
              const choice = choices[a.id];
              return (
                <Fragment key={a.id}>
                {a.id === firstDimId && (
                  <div className="col-span-full mt-1 flex items-center gap-3 pb-1 pt-2">
                    <div className="h-px flex-1 bg-[var(--border)]" />
                    <span className="shrink-0 text-[12.5px] text-[var(--text-3)]">
                      {matchedIds.length === 0
                        ? `כל התוצאות כאן ${belowLabel}`
                        : belowLabel}
                    </span>
                    <div className="h-px flex-1 bg-[var(--border)]" />
                  </div>
                )}
                <div
                  onMouseEnter={() => setHoveredId(a.id)} onMouseLeave={() => setHoveredId((h) => (h === a.id ? null : h))}
                  className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface)] text-right shadow-[var(--shadow)] transition hover:-translate-y-0.5"
                  style={{ borderColor: choice === "yes" || isSel ? "var(--brand)" : "var(--border)",
                           boxShadow: isSel ? "0 0 0 1.5px var(--brand)" : undefined }}>
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
                      {chosenAreaMemberIds.has(a.id) && a.must_see !== 1 && (
                        <span className="absolute left-2 top-2 rounded-full bg-[var(--brand)] px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">✓ בשכונה שבחרת</span>
                      )}
                      {/* editor reference — what OSM flagged, regardless of the
                          current curated pick, so the editor curates informed */}
                      {isEditor && a.osm_must_see === 1 && (
                        <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white shadow-sm backdrop-blur-sm">OSM ★ חובה</span>
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
                  {/* editor curation — two 3-state ratings written immediately:
                      importance (חובה/אולי/ממש לא) and kids fit (מתאים/אולי/לא) */}
                  {isEditor && (
                    <div className="flex flex-col gap-1.5 border-t border-[var(--border)] bg-[var(--surface-2)] py-2">
                      <EditorRateRow label="דירוג" value={a.editor_rank}
                        onPick={(v) => setRating(a, "rank", v)}
                        options={[{ v: "must", t: "חובה", bg: "var(--brand)", ink: "#fff" },
                                  { v: "maybe", t: "אולי", bg: "var(--amber-fill)", ink: "#3d2c0a" },
                                  { v: "no", t: "ממש לא", bg: "#c0453f", ink: "#fff" }]} />
                      <EditorRateRow label="ילדים" value={a.editor_kids}
                        onPick={(v) => setRating(a, "kids", v)}
                        options={[{ v: "yes", t: "מתאים", bg: "var(--brand)", ink: "#fff" },
                                  { v: "maybe", t: "אולי", bg: "var(--amber-fill)", ink: "#3d2c0a" },
                                  { v: "no", t: "ממש לא", bg: "#c0453f", ink: "#fff" }]} />
                    </div>
                  )}
                  {/* yes / no marks — the traveler's picks for this city.
                      RTL order: כן first (right), then לא. */}
                  <div className="border-t border-[var(--border)] p-2">
                    <LikeBtn liked={choice === "yes"} onClick={() => setChoice(a.id, "yes")} />
                  </div>
                </div>
                </Fragment>
              );
            })}
          </div>
          )}

          {/* one unified paginator for every mode (the list is one browse now) */}
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

      {/* persistent build bar — the flow's finish line, always visible so the
          goal is unmistakable: mark attractions, then build. Progress fills
          toward the minimum; the CTA activates once there are enough picks. */}
      <div className={`fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 shadow-[0_-8px_20px_rgba(16,29,43,0.08)] lg:px-8 ${mode === "short" && !topCtaVisible ? "" : "hidden"}`}>
        <div className="mx-auto max-w-[1600px]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* progress track toward the minimum */}
              <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--surface-2)] sm:block lg:w-32">
                <div className="h-full rounded-full bg-[var(--brand)] transition-all duration-300"
                  style={{ width: `${Math.min(100, (yesCount / minPicks) * 100)}%` }} />
              </div>
              <p className="min-w-0 truncate text-[13.5px] text-[var(--text-2)]">
                {yesCount > 0 ? (
                  <><span className="font-semibold text-[var(--text)]">{yesCount} אטרקציות</span> סומנו — מוכנים לבנות!</>
                ) : (
                  <>תנו <span className="font-medium text-[var(--brand-ink)]">❤ לייק</span> למקומות שאהבתם כדי לדייק — או בנו טיול חכם עכשיו</>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {yesCount > 0 && (
                <>
                  <button onClick={toggleSelectedOnly}
                    className="hidden items-center gap-1.5 rounded-full border px-4 py-2.5 text-[13.5px] font-medium transition sm:flex"
                    style={{ background: selectedOnly ? "var(--brand)" : "var(--surface)",
                             color: selectedOnly ? "#fff" : "var(--brand-ink)",
                             borderColor: selectedOnly ? "var(--brand)" : "var(--brand)" }}>
                    {selectedOnly ? "הצג הכל" : "הצג נבחרים"}
                  </button>
                  <button onClick={clearAllChoices} title="נקה את כל הסימונים ששמורים לעיר"
                    className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-2.5 text-[13px] text-[var(--text-3)] transition hover:border-[#c0453f] hover:text-[#c0453f]">
                    <X size={14} /> נקה
                  </button>
                </>
              )}
              {/* mirrors the top build button — the accent primary action, always
                  active whenever an audience is chosen (this bar only shows then). */}
              <button onClick={() => openBuild()}
                className="flex items-center gap-2 rounded-full px-6 py-2.5 text-[14px] font-semibold text-white transition hover:opacity-90"
                style={{ background: "var(--accent)", boxShadow: "0 6px 16px rgba(198,79,38,.32)" }}>
                <Sparkles size={16} /> בנו לי טיול{yesCount ? ` · ${yesCount}` : ""}
              </button>
            </div>
          </div>
        </div>
      </div>

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
            {overPick ? (
              <div className="mb-4 rounded-[var(--radius-sm)] border border-[var(--amber)] bg-[var(--amber-soft)] p-3">
                <p className="text-[13.5px] font-medium text-[var(--amber)]">
                  בחרתם {yesCount} מקומות · {buildDays} ימים מספיקים לכ-{buildCapacity}
                </p>
                <p className="mt-1 text-[12.5px] leading-snug text-[var(--text-2)]">
                  אפשר להוסיף ימים למטה, לחזור ולערוך את הרשימה, או להמשיך — נבחר את המתאימים ביותר ותוכלו לערוך אחר כך.
                </p>
              </div>
            ) : (
              <p className="mb-4 text-[13.5px] leading-relaxed text-[var(--text-2)]">
                {yesCount
                  ? `${yesCount} מקומות שסימנתם "כן" יהיו העוגנים, ונשלים עם החובה-לביקור באזור.`
                  : "לא סימנתם מקומות — נבחר את החובה-לביקור שמתאימים לכם. תמיד אפשר לסמן כן/לא כדי לכוון."}
              </p>
            )}
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
            <div className="mb-5">
              <div className="mb-1.5 flex items-center justify-between text-[13.5px]">
                <span>קצב הטיול</span>
                <span className="text-[var(--text-3)]">~{PACE_PER_DAY[buildPace]} אטרקציות ביום</span>
              </div>
              <div className="flex gap-1 rounded-full bg-[var(--surface-2)] p-1">
                {PACES.map((p) => {
                  const on = buildPace === p;
                  return (
                    <button key={p} onClick={() => setBuildPace(p)}
                      className="flex-1 rounded-full py-1.5 text-[13px] font-medium transition"
                      style={{ background: on ? "var(--brand)" : "transparent", color: on ? "#fff" : "var(--text-2)" }}>
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              {overPick && (
                <button onClick={() => setBuildOpen(false)}
                  className="flex-1 rounded-full border border-[var(--border)] py-3.5 text-[14px] font-medium text-[var(--text-2)] transition hover:border-[var(--brand)]">
                  ערכו את הרשימה
                </button>
              )}
              <button onClick={buildTrip} disabled={building}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3.5 text-[15px] font-medium text-white disabled:opacity-60">
                {building ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
                {overPick ? "בנו — נבחר את המתאימים" : "בנו לי טיול"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
