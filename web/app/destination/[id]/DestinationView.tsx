"use client";

import { useMemo, useState, useEffect, Fragment } from "react";
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

// Trip pace (existing profile parameter). PACE_PER_DAY is the shared capacity
// source (city page promise == heuristic builder output).
const PACES = ["רגוע", "בינוני", "אינטנסיבי"] as const;
type Pace = (typeof PACES)[number];
import { PACE_PER_DAY } from "@/lib/trip-types";
import { deriveTaste, tasteScore, INTEREST_TASTE, INTEREST_CATS } from "@/lib/taste";
import { CategoryTile } from "@/components/CategoryTiles";
import type { Attraction, Destination, Insight } from "@/lib/db";

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

// yes / maybe / no marks on a card — the traveler's picks for the trip.
const TONE: Record<Choice, { on: string; ink: string; off: string }> = {
  yes: { on: "var(--brand)", ink: "#fff", off: "var(--brand-ink)" },
  maybe: { on: "var(--amber-fill)", ink: "#3d2c0a", off: "var(--amber)" },
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

export function DestinationView({
  dest,
  attractions: baseAttractions,
  insights = {},
  placeGroups = [],
  passes = [],
  coveredIds = [],
  isEditor = false,
}: {
  dest: Destination;
  attractions: Attraction[];
  insights?: Record<number, Insight[]>;
  placeGroups?: { name: string; items: Insight[] }[];
  passes?: Pass[];
  coveredIds?: number[];
  isEditor?: boolean;
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
          const must_see = "rank" in o ? (rank === "must" ? 1 : 0) : a.must_see;
          return { ...a, editor_rank: rank ?? null, editor_kids: kids ?? null, must_see };
        })),
    [baseAttractions, ratingOverrides]
  );
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
  const [profile, setProfile] = useProfile();
  const isFamily = profile.kids.length > 0;
  // "solo" — a transient focus (not saved to the profile): show ONLY this topic.
  // Single-select. It's the 4th step of the tile cycle, after "לא מעוניין".
  const [soloInterest, setSoloInterest] = useState<string | null>(null);
  const interestState = (v: string): "yes" | "no" | "none" | "solo" =>
    soloInterest === v ? "solo"
      : profile.interests.includes(v) ? "yes"
      : profile.dislikes.includes(v) ? "no" : "none";
  const cycleInterest = (v: string) => {   // none → מעוניין → לא מעוניין → רק אותו → none
    const s = interestState(v);
    if (s === "none") setProfile({ ...profile, interests: [...profile.interests, v], dislikes: profile.dislikes.filter((x) => x !== v) });
    else if (s === "yes") setProfile({ ...profile, interests: profile.interests.filter((x) => x !== v), dislikes: [...profile.dislikes, v] });
    else if (s === "no") { setProfile({ ...profile, dislikes: profile.dislikes.filter((x) => x !== v) }); setSoloInterest(v); }
    else setSoloInterest(null);   // solo → none
  };
  const hasPrefs = profile.interests.length > 0 || profile.dislikes.length > 0;
  const [selected, setSelected] = useState<Attraction | null>(null);
  const [query, setQuery] = useState("");
  const [showPlaces, setShowPlaces] = useState(false);
  const [showPasses, setShowPasses] = useState(false);
  const [mustOnly, setMustOnly] = useState(true);   // "רק אתרי חובה" — default ON
  const [selectedOnly, setSelectedOnly] = useState(false);  // "הצג רק נבחרים"
  const [flags, setFlags] = useState({
    free: false, indoor: false, top: false, withInsights: false,
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
  const [buildPace, setBuildPace] = useState<Pace>("בינוני");
  const [building, setBuilding] = useState(false);
  // Open the build modal seeded with the traveler's saved pace.
  const openBuild = () => { setBuildPace((profile.pace as Pace) ?? "בינוני"); setBuildOpen(true); };
  const PAGE = 200;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const yesCount = Object.values(choices).filter((c) => c === "yes").length;
  const maybeCount = Object.values(choices).filter((c) => c === "maybe").length;
  // The trip needs enough anchors to be worth building. Gate the CTA on a soft
  // minimum of "כן" marks (fewer in a tiny city) so the flow reads clearly:
  // pick topics → mark attractions → build. Clicking early nudges + explains.
  const minPicks = Math.min(7, attractions.length || 7);
  const canBuild = yesCount >= minPicks;
  const [buildHint, setBuildHint] = useState(false);
  const tryBuild = () => {
    if (!canBuild) {
      setBuildHint(true);
      document.getElementById("picks")?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => setBuildHint(false), 4500);
      return;
    }
    openBuild();
  };
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
        if (selectedOnly) return choices[a.id] === "yes" || choices[a.id] === "maybe";
        // solo focus: show ALL of the focused topic (matching its tile count),
        // still respecting search / map / popover flags below. It deliberately
        // bypasses the must-see toggle — otherwise soloing "אוכל 1" could show 0
        // when that one place isn't an editor pick. Likes/dislikes are ignored.
        if (soloInterest) { if (!matchesInterest(a, soloInterest)) return false; }
        else {
          // ✕ interests hide entirely — e.g. "ילדים" on a couples' trip removes
          // every kid place, not even dimmed. An explicit כן/אולי keeps it.
          if (!choices[a.id] && profile.dislikes.some((it) => matchesInterest(a, it))) return false;
          if (mustOnly && a.must_see !== 1) return false;
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
  // Does an attraction match the traveler's profile? A ✓ interest includes it;
  // a ✕ interest excludes it; no interests set = everything matches (default).
  const profileMatch = useMemo(() => {
    const ints = profile.interests, dis = profile.dislikes;
    return (a: Attraction) =>
      (ints.length === 0 || ints.some((it) => matchesInterest(a, it)))
      && !dis.some((it) => matchesInterest(a, it));
  }, [profile.interests, profile.dislikes]);

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
  const { sortedItems, dimmedIds, matchedIds } = useMemo(() => {
    const ms = (a: Attraction) => (a.must_see === 1 ? 1 : 0);
    const img = (a: Attraction) => (a.image_url ? 1 : 0);
    // The editor's "ממש לא" is the floor — those always sink to the very bottom.
    const demote = (a: Attraction) => (a.editor_rank === "no" ? 1 : 0);
    const within = (a: Attraction, b: Attraction) => {
      if (sort === "name") return (a.name_he || a.name_en).localeCompare(b.name_he || b.name_en, "he");
      if (sort === "match" && cityTasteTagged) return tasteScore(b.taste_tags, taste) - tasteScore(a.taste_tags, taste);
      return (b.family_score ?? 0) - (a.family_score ?? 0);
    };
    const cmp = (a: Attraction, b: Attraction) => demote(a) - demote(b) || ms(b) - ms(a) || img(b) - img(a) || within(a, b);
    // Matches lead; the profile-cut tail is dimmed below (still markable). In
    // "selected only" mode there's no dimming — every pick shows in full.
    const matched: Attraction[] = [], dimmed: Attraction[] = [];
    for (const a of listItems) ((selectedOnly || soloInterest || profileMatch(a)) ? matched : dimmed).push(a);
    matched.sort(cmp); dimmed.sort(cmp);
    return { sortedItems: [...matched, ...dimmed], dimmedIds: new Set(dimmed.map((a) => a.id)), matchedIds: matched.map((a) => a.id) };
  }, [listItems, sort, cityTasteTagged, taste, profileMatch, selectedOnly, soloInterest]);

  // Paginate: show PAGE at a time; reset to page 1 on any change.
  useEffect(() => { setVisibleCount(PAGE); }, [query, mustOnly, flags, mapOnly, sort, selectedOnly, soloInterest, profile.interests, profile.dislikes]);
  // Never leave the traveler stranded in an empty "selected only" view.
  useEffect(() => { if (selectedOnly && yesCount + maybeCount === 0) setSelectedOnly(false); }, [selectedOnly, yesCount, maybeCount]);
  const visible = sortedItems.slice(0, visibleCount);
  const firstDimId = visible.find((a) => dimmedIds.has(a.id))?.id;
  // Bulk marks over the matched set (the primary view).
  const viewIds = matchedIds;
  const viewSelected = viewIds.filter((id) => choices[id]).length;

  // The traveler's picks with coordinates — highlighted on the map, and framed
  // when they tap "מקד את הנבחרים" (bumps a nonce the map watches).
  const pickedAttractions = useMemo(
    () => attractions.filter((a) => (choices[a.id] === "yes" || choices[a.id] === "maybe") && a.lat != null && a.lng != null),
    [attractions, choices]
  );
  const [fitNonce, setFitNonce] = useState(0);

  // How many must-see places sit inside the currently selected topics — a stable
  // facet count (independent of the "אתרי חובה" toggle itself), same search/map/
  // popover scope as the list. Shown on the must-see chip below the topics.
  const mustSeeCount = useMemo(() => {
    const q = query.toLowerCase();
    return attractions.filter((a) => {
      if (a.must_see !== 1 || !profileMatch(a)) return false;
      if (flags.free && a.cost_level !== 0) return false;
      if (flags.indoor && !(a.indoor_outdoor === "indoor" || a.indoor_outdoor === "both")) return false;
      if (flags.top && (a.family_score ?? 0) < 8) return false;
      if (flags.withInsights && !insights[a.id]?.length) return false;
      if (mapOnly && bounds && !(a.lat != null && a.lng != null &&
        a.lat <= bounds.north && a.lat >= bounds.south && a.lng <= bounds.east && a.lng >= bounds.west)) return false;
      if (q && !`${a.name_he ?? ""} ${a.name_en} ${descriptor(a)}`.toLowerCase().includes(q)) return false;
      return true;
    }).length;
  }, [attractions, profileMatch, flags, insights, mapOnly, bounds, query]);

  // Active popover filters (for the "פילטרים · N" badge).
  const moreFilterCount = (flags.free ? 1 : 0) + (flags.indoor ? 1 : 0) + (flags.withInsights ? 1 : 0) + (mapOnly ? 1 : 0);

  // Interest-tile counts (ALL interests are always shown so they double as the
  // profile editor) + popover filter counts. A tile's count is a STABLE FACT —
  // how many places of that interest the city holds in the current search/map
  // scope. It deliberately ignores the "רק אתרי חובה" toggle: that's an
  // additional filter on the grid, not a preference, so it must not rewrite
  // "ספורט 4" to "ספורט 0" just because none of those 4 are editor-picks.
  const { interestTiles, flagCount } = useMemo(() => {
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
      profile: { ...profile, pace: buildPace, taste, dailyDriveHours: RADIUS_HOURS[buildRadius] },
      ...(yes.length || maybe.length || no.length ? { selection: { yes, maybe, no } } : {}),
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
          <Link href="/" className="eyebrow mb-2 inline-flex items-center gap-1 text-[var(--text-2)]">
            <ChevronRight size={14} /> בית
          </Link>
          {/* one unified top bar: city identity (right) + the interests picker
              filling the rest (left), so there's no dead whitespace between them */}
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow)] lg:p-4">
            {yesCount === 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[var(--border)] pb-3 text-[15px] text-[var(--text-2)]">
                <span className="text-[16px] font-bold text-[var(--brand-ink)]">איך בונים טיול?</span>
                <span className="inline-flex items-center gap-1.5"><b className="grid size-[20px] place-items-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-white">1</b> בחרו נושאים שאתם אוהבים</span>
                <ChevronRight size={16} className="text-[var(--text-3)]" />
                <span className="inline-flex items-center gap-1.5"><b className="grid size-[20px] place-items-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-white">2</b> סמנו “כן” על אטרקציות שאהבתם</span>
                <ChevronRight size={16} className="text-[var(--text-3)]" />
                <span className="inline-flex items-center gap-1.5"><b className="grid size-[20px] place-items-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-white">3</b> נרכיב לכם את הטיול</span>
              </div>
            )}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
              {/* city identity — right in RTL */}
              <div className="flex shrink-0 items-center gap-3 sm:gap-4 lg:w-[340px]">
                <div className="relative aspect-[3/2] w-[104px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] sm:w-[150px] lg:w-[164px]">
                  <CityPoster destinationId={dest.id} cityHe={dest.city_he || dest.city}
                    orientation="landscape" position="50% 45%" className="absolute inset-0 size-full" />
                </div>
                <div className="min-w-0">
                  <h1 className="serif flex items-center gap-2 text-[24px] font-bold leading-tight lg:text-[27px]">
                    <span className="text-[0.72em]">{countryFlag(dest.country)}</span>
                    {dest.city_he || dest.city}
                  </h1>
                  <p className="mt-1 text-[14px] font-semibold text-[var(--text)]">
                    {dest.attraction_count.toLocaleString("he")} מקומות לגלות בעיר
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--brand-ink)]">
                      <Sparkles size={12} /> מותאם לפרופיל שלכם
                    </span>
                    {passes.length > 0 && (
                      <button onClick={() => setShowPasses((v) => !v)}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--brand)] bg-[var(--surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-soft)]">
                        💳 כרטיס חוסך כסף {showPasses ? "▴" : "▾"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {/* divider */}
              <div className="hidden w-px self-stretch bg-[var(--border)] lg:block" />
              {/* interests — fill the rest (left in RTL) */}
              <div className="min-w-0 flex-1">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <h2 className="text-[16px] font-bold text-[var(--text)]">מה מעניין אתכם?</h2>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-[var(--text-2)]">
                    <span>הקישו כדי לעבור בין:</span>
                    <span className="inline-flex items-center gap-1.5"><span className="grid size-[20px] place-items-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-white">✓</span> מעוניין</span>
                    <span className="inline-flex items-center gap-1.5"><span className="grid size-[20px] place-items-center rounded-full bg-[var(--text-3)] text-[12px] font-bold text-white">✕</span> לא מעוניין</span>
                    <span className="inline-flex items-center gap-1.5"><span className="grid size-[20px] place-items-center rounded-full bg-[var(--brand)]"><span className="size-[7px] rounded-full bg-white" /></span> רק אותו</span>
                  </p>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
                  {interestTiles.map(({ key, count }) => (
                    <CategoryTile key={key} label={key} state={interestState(key)} count={count}
                      dim={soloInterest != null && soloInterest !== key}
                      onClick={() => cycleInterest(key)} />
                  ))}
                </div>
                {soloInterest && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-full bg-[var(--brand)] px-4 py-1.5 text-[13px] font-medium text-white">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="grid size-[16px] place-items-center rounded-full bg-white"><span className="size-[6px] rounded-full bg-[var(--brand)]" /></span>
                      מציג רק: {soloInterest}
                    </span>
                    <button onClick={() => setSoloInterest(null)} className="rounded-full bg-white/20 px-3 py-0.5 text-[12.5px] font-semibold transition hover:bg-white/30">
                      הצג הכל
                    </button>
                  </div>
                )}
              </div>
            </div>
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

      {/* desktop toolbar — sticky filters/search above the list. Interests moved
          up into the top block; this keeps must-see · bulk · sort · filters. */}
      <div className="sticky top-[57px] z-30 hidden bg-[var(--bg)] shadow-[0_10px_12px_-12px_rgba(16,29,43,0.12)] lg:block">
        <div className="mx-auto max-w-[1600px] px-8">
          {/* filters row — search · must-see facet · bulk-select · sort · filters.
              (Interests moved to the square-tile block above.) */}
          <div className="flex items-center gap-2.5 py-2">
            <div className="flex w-[300px] shrink-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
              <Search size={16} className="shrink-0 text-[var(--text-3)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש אטרקציה, שכונה או סוג מקום…"
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]" />
            </div>
            <span className="mx-1 h-5 w-px shrink-0 bg-[var(--border)]" />
            <button onClick={() => setMustOnly((v) => !v)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition"
              style={{ background: mustOnly ? "var(--brand)" : "var(--surface)",
                       color: mustOnly ? "#fff" : "var(--text-2)", borderColor: mustOnly ? "var(--brand)" : "var(--border)" }}>
              ⭐ אתרי חובה <span className={mustOnly ? "opacity-80" : "opacity-60"}>{mustSeeCount}</span>
            </button>
            {yesCount + maybeCount > 0 && (
              <button onClick={() => setSelectedOnly((v) => !v)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition"
                style={{ background: selectedOnly ? "var(--brand)" : "var(--brand-soft)",
                         color: selectedOnly ? "#fff" : "var(--brand-ink)",
                         borderColor: selectedOnly ? "var(--brand)" : "transparent" }}>
                <Check size={14} /> אטרקציות שנבחרו <span className="opacity-70">{yesCount}{maybeCount ? `+${maybeCount}` : ""}</span>
              </button>
            )}
            <span className="mx-1 h-5 w-px shrink-0 bg-[var(--border)]" />
            {viewIds.length > 0 && (
              <>
                <button onClick={() => setMany(viewIds, "yes")}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--brand)] bg-[var(--surface)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--brand-ink)] transition">
                  <Check size={14} /> בחר הכל · {viewIds.length}
                </button>
                {viewSelected > 0 && (
                  <button onClick={() => setMany(viewIds, null)}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--text-2)] transition hover:border-[#c0453f] hover:text-[#c0453f]">
                    <X size={14} /> נקה · {viewSelected}
                  </button>
                )}
                <span className="mx-1 h-5 w-px shrink-0 bg-[var(--border)]" />
              </>
            )}

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
                <div className="absolute z-40 mt-1 w-60 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow)]">
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

            <div className="mr-auto flex shrink-0 items-center gap-3">
              <span className="text-[13px] text-[var(--text-3)]">{matchedIds.length} מקומות</span>
            </div>
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
        <div className="relative sticky top-0 z-10 h-[240px] w-full overflow-hidden border-y border-[var(--border)] lg:order-2 lg:h-[calc(100dvh-164px)] lg:top-[164px] lg:w-[380px] lg:shrink-0 lg:border-y-0 lg:border-s">
          <MapClient attractions={visible} center={[dest.lat, dest.lng]} selected={selected}
            picks={pickedAttractions} fitNonce={fitNonce} onBounds={setBounds} />
          {pickedAttractions.length > 0 && (
            <button onClick={() => setFitNonce((n) => n + 1)}
              className="absolute left-1/2 top-3 z-[1000] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--brand)] bg-[var(--surface)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--brand-ink)] shadow-[var(--shadow)] transition hover:bg-[var(--brand-soft)]">
              <MapPin size={14} /> מקד את הנבחרים · {pickedAttractions.length}
            </button>
          )}
        </div>

        {/* attraction cards — a grid on desktop, single column on mobile */}
        <section id="picks" className="scroll-mt-[120px] px-5 lg:order-1 lg:min-w-0 lg:flex-1 lg:px-8 lg:pb-16">
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
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setMustOnly((v) => !v)}
                className="rounded-full px-3 py-1.5 text-[13.5px] font-medium transition"
                style={{ background: mustOnly ? "var(--brand)" : "var(--surface)",
                         color: mustOnly ? "#fff" : "var(--text-2)", border: `1px solid ${mustOnly ? "var(--brand)" : "var(--border)"}` }}>
                ⭐ אתרי חובה <span className="opacity-70">{mustSeeCount}</span>
              </button>
              {yesCount + maybeCount > 0 && (
                <button onClick={() => setSelectedOnly((v) => !v)}
                  className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13.5px] font-medium transition"
                  style={{ background: selectedOnly ? "var(--brand)" : "var(--brand-soft)",
                           color: selectedOnly ? "#fff" : "var(--brand-ink)",
                           borderColor: selectedOnly ? "var(--brand)" : "transparent" }}>
                  <Check size={13} /> {selectedOnly ? "הצג הכל" : `הצג נבחרים · ${yesCount}${maybeCount ? `+${maybeCount}` : ""}`}
                </button>
              )}
              {viewIds.length > 0 && (
                <>
                  <button onClick={() => setMany(viewIds, "yes")}
                    className="rounded-full border border-[var(--brand)] px-3 py-1.5 text-[13.5px] font-medium text-[var(--brand-ink)]">
                    ✓ בחר הכל · {viewIds.length}
                  </button>
                  {viewSelected > 0 && (
                    <button onClick={() => setMany(viewIds, null)}
                      className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[13.5px] font-medium text-[var(--text-2)]">
                      ✗ נקה · {viewSelected}
                    </button>
                  )}
                </>
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

          {/* rich image-top cards — matches first, then the profile-cut tail
              (dimmed, still markable) after a divider */}
          <div className="grid grid-cols-1 gap-4 pt-3 sm:grid-cols-2 lg:pt-4 xl:grid-cols-3">
            {visible.map((a) => {
              const isSel = selected?.id === a.id;
              const cost = a.cost_level != null ? COST_HE[a.cost_level] : null;
              const dur = durationHe(a.duration_minutes);
              const cat = mergeCat(a.category);
              const insList = insights[a.id] ?? [];
              const tip = insList[0]?.text_he || a.tips_he;
              const choice = choices[a.id];
              const dim = dimmedIds.has(a.id);
              return (
                <Fragment key={a.id}>
                {a.id === firstDimId && (
                  <div className="col-span-full mt-1 flex items-center gap-3 pb-1 pt-2">
                    <div className="h-px flex-1 bg-[var(--border)]" />
                    <span className="shrink-0 text-[12.5px] text-[var(--text-3)]">מחוץ להעדפות שלכם — אפשר בכל זאת לסמן</span>
                    <div className="h-px flex-1 bg-[var(--border)]" />
                  </div>
                )}
                <div
                  className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface)] text-right shadow-[var(--shadow)] transition hover:-translate-y-0.5"
                  style={{ borderColor: choice === "yes" || isSel ? "var(--brand)" : "var(--border)",
                           boxShadow: isSel ? "0 0 0 1.5px var(--brand)" : undefined,
                           opacity: choice === "no" ? 0.5 : dim ? 0.6 : 1 }}>
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
                  {/* yes / maybe / no marks — the traveler's picks for this city.
                      RTL order: כן first (right), then אולי, then לא. */}
                  <div className="grid grid-cols-3 gap-1.5 border-t border-[var(--border)] p-2">
                    <ChoiceBtn tone="yes" active={choice === "yes"} onClick={() => setChoice(a.id, "yes")} icon={<Check size={13} />} label="כן" />
                    <ChoiceBtn tone="maybe" active={choice === "maybe"} onClick={() => setChoice(a.id, "maybe")} icon={<HelpCircle size={13} />} label="אולי" />
                    <ChoiceBtn tone="no" active={choice === "no"} onClick={() => setChoice(a.id, "no")} icon={<X size={13} />} label="לא" />
                  </div>
                </div>
                </Fragment>
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

      {/* persistent build bar — the flow's finish line, always visible so the
          goal is unmistakable: mark attractions, then build. Progress fills
          toward the minimum; the CTA activates once there are enough picks. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 shadow-[0_-8px_20px_rgba(16,29,43,0.08)] lg:px-8">
        <div className="mx-auto max-w-[1600px]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* progress track toward the minimum */}
              <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--surface-2)] sm:block lg:w-32">
                <div className="h-full rounded-full bg-[var(--brand)] transition-all duration-300"
                  style={{ width: `${Math.min(100, (yesCount / minPicks) * 100)}%` }} />
              </div>
              <p className="min-w-0 truncate text-[13.5px] text-[var(--text-2)]">
                {canBuild ? (
                  <><span className="font-semibold text-[var(--text)]">{yesCount} אטרקציות</span> נבחרו — מוכנים לבנות!{maybeCount ? <span className="text-[var(--text-3)]"> · {maybeCount} אולי</span> : null}</>
                ) : yesCount === 0 ? (
                  <>סמנו אטרקציות שאהבתם <span className="font-medium text-[var(--brand-ink)]">(כן 👍)</span> — לפחות {minPicks} — ונרכיב לכם טיול</>
                ) : (
                  <><span className="font-semibold text-[var(--text)]">{yesCount}/{minPicks}</span> — בחרו עוד {minPicks - yesCount} כדי לבנות טיול</>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {yesCount + maybeCount > 0 && (
                <button onClick={() => setSelectedOnly((v) => !v)}
                  className="hidden items-center gap-1.5 rounded-full border px-4 py-2.5 text-[13.5px] font-medium transition sm:flex"
                  style={{ background: selectedOnly ? "var(--brand)" : "var(--surface)",
                           color: selectedOnly ? "#fff" : "var(--brand-ink)",
                           borderColor: selectedOnly ? "var(--brand)" : "var(--brand)" }}>
                  {selectedOnly ? "הצג הכל" : "הצג נבחרים"}
                </button>
              )}
              <button onClick={tryBuild}
                className="flex items-center gap-2 rounded-full px-6 py-2.5 text-[14px] font-semibold transition"
                style={canBuild
                  ? { background: "var(--brand)", color: "#fff", boxShadow: "0 6px 16px rgba(14,107,94,.3)" }
                  : { background: "var(--surface-2)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                <Sparkles size={16} /> {canBuild ? `בנו לי טיול · ${yesCount}` : "בנו לי טיול"}
              </button>
            </div>
          </div>
          {buildHint && !canBuild && (
            <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--amber-soft)] px-3 py-1.5 text-[12.5px] text-[var(--amber)]">
              כדי לבנות טיול מותאם, סמנו לפחות {minPicks} אטרקציות שאהבתם בכפתור “כן” 👍 מהרשימה{yesCount ? ` (בחרתם ${yesCount} עד כה)` : ""}.
            </p>
          )}
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
                  ? `${yesCount} מקומות שסימנתם "כן" יהיו העוגנים${maybeCount ? `, ו-${maybeCount} "אולי" ישתלבו אם יש זמן` : ""}.`
                  : "לא סימנתם מקומות — נבחר את החובה-לביקור שמתאימים לכם. תמיד אפשר לסמן כן/אולי/לא כדי לכוון."}
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
