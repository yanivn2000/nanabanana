"use client";

import { useMemo, useState, useEffect, useRef, Fragment } from "react";
import Link from "next/link";
import { ChevronRight, Search, Sparkles, ChevronDown, Check, MapPin, X, Loader2, Heart, ExternalLink,
  Compass, Star, Map as MapIcon, Baby, Palette, UtensilsCrossed, Trees, Wine, Landmark, Building2, Watch, Gem, FerrisWheel, Waves,
  Coins, Umbrella, MessageCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Elegant outline icons per category (brand-coloured, stroke-only) — a Booking-ish
// look, replacing the emoji.
const CAT_ICON: Record<string, LucideIcon> = {
  __all: Compass, __must: Star, __areas: MapIcon, __kids: Baby,
  "מוזיאונים": Palette, "אוכל": UtensilsCrossed, "טבע": Trees, "חיי לילה": Wine,
  "היסטוריה": Landmark, "אדריכלות": Building2, "וינטג'": Watch, "יוקרה": Gem,
  "פארקי שעשועים": FerrisWheel, "חופים": Waves,
};
import { googleMapsPin } from "@/lib/geo";
import { MapClient } from "@/components/MapClient";
import { CityPoster } from "@/components/CityPoster";
import { descriptor, catColor, bigImage, hiResImage, mergeCat, countryFlag, wikiUrl } from "@/lib/labels";
import { passUrl, type Pass } from "@/lib/passes";
import { useRouter } from "next/navigation";
import { useProfile, useTrips, useCitySelection, type Choice } from "@/lib/store";
import { useNavTitle } from "@/components/NavTitle";

// distance slider index → per-trip dailyDriveHours (same scale as the old flow)
const RADIUS_HOURS = [0.5, 1, 2, 3];
const RADIUS_HE = ["קרוב מאוד", "עד שעה", "עד שעתיים", "גם רחוק"];

// Trip pace is now a direct attractions-per-day number (3–6) instead of the old
// רגוע/בינוני/אינטנסיבי labels. paceToPerDay reads either (number wins).
const PER_DAY_MIN = 3, PER_DAY_MAX = 6;
import { paceToPerDay } from "@/lib/trip-types";
import { deriveTaste, tasteScore, coarseFits, audienceFit, INTEREST_TASTE, INTEREST_CATS, GOVERNING_INTERESTS } from "@/lib/taste";
import { PROFILES, PROFILE_HE, PROFILE_EMOJI, type Profile } from "@/lib/shortpath";

// Below this audience-fit (0-100) a place is "less relevant" for the chosen
// audience → it drops BELOW the divider (still markable), never hidden. Mirrors
// the old shortPath FIT_FLOOR so the cut is the same, just soft instead of hard.
const AUDIENCE_FIT_FLOOR = 35;
import type { Attraction, Destination, Insight, AreaCard, Street } from "@/lib/db";

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

// A single toggle: "in the trip" (choice "yes") vs unmarked (the builder ignores
// it). Labelled around trip inclusion so it's clear it isn't a social "like".
function LikeBtn({ liked, onClick, disabled }: { liked: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={disabled}
      aria-pressed={liked} title={disabled ? "בחרו קהל ותחום כדי לבחור מקומות" : liked ? "לחצו כדי להוציא מהטיול" : "רוצה שיהיה חלק מהטיול"}
      className="flex w-full items-center justify-center gap-1.5 rounded-full border py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: liked ? "var(--brand)" : "var(--surface)", color: liked ? "#fff" : "var(--text-2)",
               borderColor: liked ? "var(--brand)" : "var(--border)" }}>
      <Heart size={14} fill={liked ? "currentColor" : "none"} /> {liked ? "בטיול" : "רוצה בטיול"}
    </button>
  );
}

// Compact version — sits ON the card frame (list rows), so a row costs no extra
// full-width strip of air. + to add to the trip, ✓ when it's in.
function HeartToggle({ liked, onClick, disabled }: { liked: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-pressed={liked} disabled={disabled}
      aria-label={liked ? "בטיול" : "רוצה בטיול"} title={disabled ? "בחרו קהל ותחום כדי לבחור מקומות" : liked ? "בטיול — לחצו כדי להוציא" : "רוצה שיהיה חלק מהטיול"}
      className="grid shrink-0 place-items-center self-stretch px-3.5 transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      style={{ color: liked ? "var(--brand)" : "var(--text-3)" }}>
      <Heart size={20} fill={liked ? "currentColor" : "none"} />
    </button>
  );
}

// A pickable STREET chip — streets are their own entity (own id space), picked
// here and sent to the build as streetIds. Brand-filled + ✓ when it's in the trip.
function StreetPill({ s, picked, onToggle }: { s: Street; picked: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-pressed={picked}
      title={s.area_name_he ? `רחוב · ${s.area_name_he}` : "רחוב"}
      className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13.5px] font-medium transition"
      style={{ background: picked ? "var(--brand)" : "var(--surface)", color: picked ? "#fff" : "var(--text-2)",
               borderColor: picked ? "var(--brand)" : "var(--border)" }}>
      <span aria-hidden>🛣️</span>
      <span className="max-w-[170px] truncate">{s.name_he || s.name_en}</span>
      {picked && <Check size={13} />}
    </button>
  );
}

// A full street CARD — some streets are attractions in their own right, so they
// get the same treatment as a place: a photo (or a brand-tinted placeholder), the
// vibe as the story, a "רוצה בטיול" toggle, and click-to-expand to a wide card.
function StreetCard({ s, picked, expanded, onToggle, onOpen }: {
  s: Street; picked: boolean; expanded: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const HDR = "linear-gradient(140deg, color-mix(in srgb, var(--brand) 22%, var(--surface-2)), var(--surface-2) 72%)";
  return (
    <div className={`group flex scroll-mt-24 flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface)] text-right shadow-[var(--shadow)] transition ${expanded ? "sm:col-span-2 xl:col-span-3" : ""}`}
      style={{ borderColor: picked ? "var(--brand)" : "var(--border)", boxShadow: picked ? "0 0 0 1.5px var(--brand)" : undefined }}>
      <div role="button" tabIndex={0} onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        className={`flex flex-1 cursor-pointer text-right ${expanded ? "flex-col sm:flex-row sm:items-stretch sm:min-h-[260px]" : "flex-col"}`}>
        <div className={`relative w-full overflow-hidden ${expanded ? "aspect-[16/10] sm:aspect-auto sm:w-[44%] sm:shrink-0" : "aspect-[16/10]"}`}
          style={s.image_url ? undefined : { background: HDR }}>
          {s.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={(expanded ? hiResImage(s.image_url, 1100) : hiResImage(s.image_url, 700)) ?? s.image_url} alt="" loading="lazy"
              onError={(e) => { const t = e.currentTarget; if (s.image_url && t.src !== s.image_url) t.src = s.image_url; }}
              className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
          ) : (
            <div className="grid size-full place-items-center text-[46px]" aria-hidden>🛣️</div>
          )}
          <span className="absolute right-2 top-2 rounded-full bg-[var(--brand)] px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">רחוב</span>
          {s.area_name_he && (
            <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">{s.area_name_he}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-3">
          <p className={`serif text-[17px] font-bold leading-tight ${expanded ? "" : "truncate"}`}>{s.name_he || s.name_en}</p>
          {s.name_en && s.name_en !== (s.name_he ?? "") && (
            <p className="truncate text-[12.5px] text-[var(--text-3)]" dir="ltr" style={{ unicodeBidi: "isolate" }}>{s.name_en}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
            {s.best_for_he && <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 font-medium text-[var(--brand-ink)]">{s.best_for_he}</span>}
            {s.dwell_min ? <span className="text-[var(--text-3)]">🕐 ~{s.dwell_min} דק׳</span> : null}
          </div>
          {s.vibe_he && <p className={`mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)] ${expanded ? "" : "line-clamp-3"}`}>{s.vibe_he}</p>}
          {expanded && s.lat != null && s.lng != null && (
            <a href={googleMapsPin(s.lat, s.lng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
              className="mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[12.5px] text-[var(--text-2)]">
              <MapPin size={12} /> פתח במפה
            </a>
          )}
        </div>
      </div>
      <div className="border-t border-[var(--border)] p-2">
        <button onClick={onToggle} aria-pressed={picked}
          title={picked ? "בטיול — לחצו כדי להוציא" : "רוצה שיהיה חלק מהטיול"}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border py-1.5 text-[13px] font-medium transition"
          style={{ background: picked ? "var(--brand)" : "var(--surface)", color: picked ? "#fff" : "var(--text-2)",
                   borderColor: picked ? "var(--brand)" : "var(--border)" }}>
          <Heart size={14} fill={picked ? "currentColor" : "none"} /> {picked ? "בטיול" : "רוצה בטיול"}
        </button>
      </div>
    </div>
  );
}

// Headline neighbourhoods, IN the attractions list, in the same row design — but a
// neighbourhood is "an attraction that contains attractions": its own frame-heart
// tours the WHOLE area (a half/full-day block the builder composes), and expanding
// reveals its member places, each likeable on its own. Members are deduped OUT of
// the flat list (they live only inside their neighbourhood).
function NeighbourhoodRows({ areas, chosenIds, attrById, isPicked, onToggleArea, onToggleMember, onFocus, onMemberFocus, locked, insights = {} }: {
  areas: AreaCard[]; chosenIds: Set<number>;
  attrById: Map<number, Attraction>;
  isPicked: (id: number) => boolean;
  onToggleArea: (id: number) => void;
  onToggleMember: (id: number) => void;
  onFocus: (a: AreaCard) => void;
  onMemberFocus?: (m: Attraction) => void;   // fly the map to a clicked member (like a flat card)
  locked?: boolean;
  insights?: Record<number, Insight[]>;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [openMemberId, setOpenMemberId] = useState<number | null>(null);   // expand a member for its details
  if (!areas.length) return null;
  return (
    <div className="flex flex-col gap-2.5 pt-3">
      {areas.map((area) => {
        const members = area.member_ids.map((id) => attrById.get(id)).filter((m): m is Attraction => !!m);
        const toured = chosenIds.has(area.id);
        const open = openId === area.id;
        const heroImg = members.find((m) => m.image_url)?.image_url ?? null;
        const pickedInside = members.filter((m) => isPicked(m.id)).length;
        const active = toured || pickedInside > 0;
        return (
          <div key={area.id}
            className="overflow-hidden rounded-[var(--radius-card)] border-2 shadow-[var(--shadow)] transition"
            style={{ borderColor: active ? "var(--brand)" : "var(--brand-soft)",
                     background: "color-mix(in srgb, var(--brand-soft) 45%, var(--surface))" }}>
            {/* a distinct tinted banner so a neighbourhood never reads as a plain place */}
            <div className="flex items-center gap-2 px-2.5 pt-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand)] px-2.5 py-0.5 text-[11px] font-bold text-white">
                🏘️ שכונה
              </span>
              <span className="text-[11.5px] text-[var(--brand-ink)]">אזור שלם — {members.length} מקומות ביחד</span>
            </div>
            <div className="flex items-stretch">
              <button onClick={() => { setOpenId(open ? null : area.id); onFocus(area); }}
                className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-right">
                {heroImg ? (
                  <span className="relative size-14 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={bigImage(heroImg, 200)} alt="" loading="lazy" className="size-14 rounded-[10px] object-cover ring-2 ring-[var(--brand-soft)]" />
                    <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-[var(--brand)] text-[12px] shadow-sm">🏘️</span>
                  </span>
                ) : (
                  <div className="grid size-14 shrink-0 place-items-center rounded-[10px] bg-[var(--brand)] text-[24px]">🏘️</div>
                )}
                <div className="min-w-0 shrink-0 max-w-[52%]">
                  <p className="serif truncate text-[16px] font-bold leading-tight">{area.name_he || area.name_en}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-[var(--text-3)]">
                    {area.must_count > 0 && <span>⭐ {area.must_count} חובה</span>}
                    {pickedInside > 0 && <span className="font-medium text-[var(--brand-ink)]">✓ {pickedInside} סומנו</span>}
                  </div>
                </div>
                {area.vibe_he && <p className="hidden min-w-0 flex-1 truncate text-[13.5px] italic text-[var(--text-2)] sm:block">{area.vibe_he}</p>}
                <ChevronDown size={18} className={`ms-auto shrink-0 text-[var(--brand-ink)] transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {/* the container's "heart" — tour the WHOLE neighbourhood. Filled solid
                  whenever the area is toured OR has ≥1 picked member inside. */}
              <button onClick={() => onToggleArea(area.id)} aria-pressed={toured} disabled={locked}
                aria-label={toured ? "מטיילים בכל השכונה" : "טיילו בכל השכונה"} title={locked ? "בחרו קהל ותחום כדי לבחור מקומות" : toured ? "מטיילים בכל השכונה" : "טיילו בכל השכונה"}
                className="grid shrink-0 place-items-center self-stretch px-3.5 transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                style={{ color: active ? "var(--brand)" : "var(--text-3)" }}>
                <Heart size={20} fill={active ? "currentColor" : "none"} />
              </button>
            </div>
            {open && (
              <div className="border-t border-[var(--border)] bg-[var(--surface-2)] p-2.5">
                {/* the neighbourhood's full blurb — truncated to one line in the header,
                    shown in full here so it never reads as cut off */}
                {area.vibe_he && <p className="px-0.5 pb-2 text-[13.5px] italic leading-relaxed text-[var(--text-2)]">{area.vibe_he}</p>}
                <p className="px-0.5 pb-2 text-[12px] text-[var(--text-3)]">
                  סמנו ❤ למעלה כדי לטייל בכל השכונה — או בחרו מקומות ספציפיים מתוכה:
                </p>
                <div className="flex flex-col gap-1.5">
                  {members.map((m) => {
                    const picked = isPicked(m.id);
                    const cat = mergeCat(m.category);
                    const openM = openMemberId === m.id;
                    const insList = insights[m.id] ?? [];
                    const tip = insList[0]?.text_he || m.tips_he;
                    // Same detail surface as a flat card — only offer the expand when
                    // there's something behind it (photo or any tip/description/when/dress).
                    const canExpand = !!(m.image_url || m.description_he || tip || insList.length > 1 || m.best_time_he || m.dress_he);
                    return (
                      <div key={m.id} className="overflow-hidden rounded-[10px] border bg-[var(--surface)]"
                        style={{ borderColor: picked ? "var(--brand)" : "var(--border)" }}>
                        <div className="flex items-center gap-2.5 p-1.5">
                          <button onClick={() => { onMemberFocus?.(m); if (canExpand) setOpenMemberId(openM ? null : m.id); }}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-right">
                            {m.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={bigImage(m.image_url, 120)} alt="" loading="lazy" className="size-11 shrink-0 rounded-[8px] object-cover" />
                            ) : (
                              <div className="grid size-11 shrink-0 place-items-center rounded-[8px]" style={{ background: `color-mix(in srgb, ${catColor(cat)} 16%, var(--surface-2))` }}>
                                <MapPin size={16} style={{ color: catColor(cat) }} />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13.5px] font-semibold">
                                {m.must_see === 1 && <span className="text-[var(--accent-ink)]">⭐ </span>}
                                {m.name_he || m.name_en}
                              </p>
                              <p className="truncate text-[12px] text-[var(--text-3)]">
                                {CAT_HE[cat] ?? m.category}{m.tagline_he ? ` · ${m.tagline_he}` : ""}
                              </p>
                            </div>
                            {canExpand && <ChevronDown size={16} className={`ms-auto shrink-0 text-[var(--text-3)] transition-transform ${openM ? "rotate-180" : ""}`} />}
                          </button>
                          <button onClick={() => onToggleMember(m.id)} aria-pressed={picked} disabled={locked}
                            aria-label={picked ? "בטיול" : "רוצה בטיול"} title={locked ? "בחרו קהל ותחום כדי לבחור מקומות" : picked ? "בטיול — לחצו כדי להוציא" : "רוצה שיהיה חלק מהטיול"}
                            className="grid size-9 shrink-0 place-items-center rounded-full transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                            style={{ color: picked || toured ? "var(--brand)" : "var(--text-3)" }}>
                            <Heart size={18} fill={picked || toured ? "currentColor" : "none"} />
                          </button>
                        </div>
                        {openM && canExpand && (
                          <div className="border-t border-[var(--border)] p-2.5">
                            <div className="flex flex-col gap-2.5 sm:flex-row">
                              {m.image_url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={bigImage(m.image_url, 640)} alt="" loading="lazy"
                                  onError={(e) => { const t = e.currentTarget; if (m.image_url && t.src !== m.image_url) t.src = m.image_url; }}
                                  className="aspect-[4/3] w-full shrink-0 rounded-[8px] object-cover sm:w-[38%] sm:self-start" />
                              )}
                              <div className="min-w-0 flex-1">
                                {m.description_he && <p className="text-[13px] leading-relaxed text-[var(--text-2)]">{m.description_he}</p>}
                                {tip && <p className="mt-1.5 flex items-start gap-1 text-[12.5px] leading-snug text-[var(--brand-ink)]"><span className="shrink-0">💡</span><span>טיפ מטיילים: {tip}</span></p>}
                                {insList.length > 1 && (
                                  <div className="mt-1.5 flex flex-col gap-1">
                                    {insList.slice(1).map((ins) => (
                                      <p key={ins.id} className="flex items-start gap-1 text-[12px] leading-snug text-[var(--brand-ink)]"><span className="shrink-0">{KIND_ICON[ins.kind] ?? "💬"}</span><span>{ins.text_he}</span></p>
                                    ))}
                                  </div>
                                )}
                                {(m.best_time_he || m.dress_he) && (
                                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[var(--text-2)]">
                                    {m.best_time_he && <span><span className="text-[var(--text-3)]">מתי: </span>{m.best_time_he}</span>}
                                    {m.dress_he && <span><span className="text-[var(--text-3)]">לבוש: </span>{m.dress_he}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
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
  streets = [],
  editorial = false,
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
  streets?: Street[];
  editorial?: boolean;
}) {
  const covered = new Set(coveredIds);
  // Editor rank/kids come straight from the server now (the per-card editor
  // rating controls were removed); filtering + sort read a.editor_* directly.
  const attractions = baseAttractions;
  // Lookup for the neighbourhood strip to list each area's attractions by id.
  const attrById = useMemo(() => new Map(attractions.map((a) => [a.id, a])), [attractions]);
  // family_score is a family-friendliness metric — only surface it (the
  // "מומלץ למשפחות" filter, the score star) when the traveler has kids.
  // The profile is editable right here: the interest tiles are the same 3-state
  // control as the profile page, writing to profile.interests / profile.dislikes.
  const [profile] = useProfile();
  // Show "אמסטרדם 🇳🇱" next to the logo in the top nav while on this city page.
  const { setTitle } = useNavTitle();
  useEffect(() => {
    setTitle(<>{dest.city_he || dest.city} <span aria-hidden>{countryFlag(dest.country)}</span></>);
    return () => setTitle(null);
  }, [dest.city_he, dest.city, dest.country, setTitle]);
  const isFamily = profile.kids.length > 0;
  // "solo" — a transient focus (not saved to the profile): show ONLY this topic.
  // Single-select. It's the 4th step of the tile cycle, after "לא מעוניין".
  const [soloInterest, setSoloInterest] = useState<string | null>(null);
  const [selectedOnly, setSelectedOnly] = useState(false);  // "הצג רק נבחרים" — mutually exclusive with solo
  const toggleSelectedOnly = () => { setSoloInterest(null); setSelectedOnly((v) => !v); };
  // How the attraction list renders: a compact LIST in the trip-page design language
  // (default — row → expands down, image on the right, info across) or image-top TILES.
  // List is the default; the editorial variant (M5b) uses the image-top TILE grid
  // (already built below) for a photo-forward "sell the city" browse.
  const listView = !editorial;
  // (The interest ✓/✕/solo cycler + editor were retired with the "הכל" mode;
  // soloInterest state stays as a harmless no-op the list filter still reads.)
  const [selected, setSelected] = useState<Attraction | null>(null);
  // The selected card grows to a full-width row, which the grid reflows onto its
  // own line further down — keep a ref to it so we can scroll it back into view
  // instead of leaving the traveller to hunt for it below the fold. On CLOSE the
  // grid reflows the other way, so scroll the now-collapsed card back into view
  // too (found by data-aid, since selCardRef only attaches while selected).
  const selCardRef = useRef<HTMLDivElement | null>(null);
  const prevSelId = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevSelId.current;
    prevSelId.current = selected?.id ?? null;
    if (selected) {
      const el = selCardRef.current;
      if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else if (prev != null) {
      const el = document.querySelector(`[data-aid="${prev}"]`);
      if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    }
  }, [selected]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);  // card hover → grow its map marker
  const [query, setQuery] = useState("");
  const [showPlaces, setShowPlaces] = useState(false);
  const [showPasses, setShowPasses] = useState(false);
  const [mustOnly, setMustOnly] = useState(false);   // "רק אתרי חובה" — default OFF (show all)
  const [flags, setFlags] = useState({
    free: false, indoor: false, top: false, withInsights: false,
  });
  const toggleFlag = (k: keyof typeof flags) =>
    setFlags((f) => ({ ...f, [k]: !f[k] }));
  // #13 — narrow the list to what's currently visible on the map.
  // Two ways in: "choose" (the default — pick an audience) and "short" (an audience
  // is chosen → the calibratable topic chips + one-tap build). The old "explore /
  // הכל" deep-editor mode was retired; its filters live next to the search now.
  // Editorial drops the "who is the trip for?" step: default to adults, and the
  // "עם ילדים" tab's ♥ flips it to families (see the tab bar). Classic keeps the picker.
  const [audience, setAudience] = useState<Profile | null>(() => editorial ? "adults" : null);
  const [boosts, setBoosts] = useState<Set<string>>(new Set());
  // Two flows: GUIDED (default — audience → topics → the system pre-marks → you
  // adjust) and MANUAL/"בנייה חופשית" (steps ①② off — you pick every place yourself
  // from a blank slate; the trip is EXACTLY your ❤, and the bank holds all ⭐ must-sees).
  const [manual, setManual] = useState(false);
  const MANUAL_MIN = 7;   // manual build unlocks once this many places are marked
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
  const [sort] = useState<SortKey>("match");   // default sort; the picker was removed
  // Per-city yes/maybe/no marks (the "city profile") + the build modal.
  const { create } = useTrips();
  const { choices, setChoice, setMany, clear, loaded: selLoaded } = useCitySelection(dest.id);
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
  const [perDay, setPerDay] = useState(() => Math.min(PER_DAY_MAX, Math.max(PER_DAY_MIN, paceToPerDay(profile?.pace as string))));   // attractions per day (3–6)
  const [building, setBuilding] = useState(false);
  // Streets the traveller explicitly picked (search / neighbourhood). Streets have
  // their own id space; they go to the build as `streetIds`. Persisted per city.
  const streetKey = `yalle.streetpicks.${dest.id}`;
  const [streetPicks, setStreetPicks] = useState<Set<number>>(new Set());
  useEffect(() => {
    try { const raw = localStorage.getItem(streetKey); if (raw) setStreetPicks(new Set(JSON.parse(raw) as number[])); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest.id]);
  const toggleStreet = (id: number) => setStreetPicks((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(streetKey, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });
  const [openStreetId, setOpenStreetId] = useState<number | null>(null);   // which street card is expanded
  const streetsById = useMemo(() => new Map(streets.map((s) => [s.id, s])), [streets]);
  const streetsByArea = useMemo(() => {
    const m = new Map<number, Street[]>();
    for (const s of streets) if (s.area_id != null) { const l = m.get(s.area_id) ?? []; l.push(s); m.set(s.area_id, l); }
    return m;
  }, [streets]);
  // Streets matching the search box (name en/he) — surfaced above the cards so a
  // traveller can find & add "Oxford Street" / "תשעת הרחובות" directly. Hebrew
  // construct/gender changes the last letter (תשעה↔תשעת), so also match on the
  // stem (query minus its final letter) to be forgiving.
  const matchedStreets = useMemo(() => {
    const raw = query.trim(); const q = raw.toLowerCase();
    if (raw.length < 2) return [];
    const heStem = raw.length >= 3 && /[֐-׿]/.test(raw) ? raw.slice(0, -1) : null;
    return streets.filter((s) => {
      const en = (s.name_en ?? "").toLowerCase();
      const he = s.name_he ?? "";
      return en.includes(q) || he.includes(raw) || (heStem != null && he.includes(heStem));
    });
  }, [streets, query]);
  // Open the build modal seeded with the traveler's saved pace (as a per-day count).
  const openBuild = () => { setBuildOpen(true); };
  const PAGE = 200;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  // Editorial city browse: the long flat list is split into tabs — "שכונות" (with a
  // sub-tab per neighbourhood) + one tab per governing interest. cityTab is the active
  // top tab ("__areas" or an interest key); areaTab is the chosen neighbourhood.
  const [cityTab, setCityTab] = useState<string>("__must");
  const [areaTab, setAreaTab] = useState<number | null>(null);
  const yesCount = Object.values(choices).filter((c) => c === "yes").length;
  // Likes are optional refinements now — the governed build works from audience +
  // topics alone, so building is always available once an audience is chosen (no
  // pick-minimum, no progress meter).
  // Capacity follows the chosen pace, so the estimate matches what the builder
  // will actually schedule (רגוע ~4/day, בינוני ~5, אינטנסיבי ~6).
  const buildCapacity = buildDays * perDay;
  const overPick = yesCount > buildCapacity;

  const router = useRouter();
  const taste = useMemo(() => deriveTaste(profile), [profile]);
  const cityTasteTagged = useMemo(() => attractions.some((a) => a.taste_tags?.length), [attractions]);

  // The visible list: must-see by default (the "רק אתרי חובה" toggle), narrowed
  // to the active interest tile + the popover filters. Search runs over the
  // whole loaded city.
  // Every attraction that belongs to a headline neighbourhood — deduped OUT of the
  // flat list (they live inside their neighbourhood card), except while searching.
  const allAreaMemberIds = useMemo(() => new Set(areas.flatMap((a) => a.member_ids)), [areas]);
  const filtered = useMemo(
    () =>
      attractions.filter((a) => {
        // "הצג רק נבחרים" overrides the other filters: show exactly the places
        // the traveler marked (כן/אולי), so a lone pick is always findable.
        if (selectedOnly) return choices[a.id] === "yes";
        // a neighbourhood member isn't listed standalone — it shows inside its
        // neighbourhood row (in BOTH flows). A search query bypasses this so any
        // place stays findable.
        if (!query && allAreaMemberIds.has(a.id)) return false;
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
    [attractions, mustOnly, query, flags, insights, selectedOnly, choices, profile.dislikes, soloInterest, allAreaMemberIds]
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

  const { sortedItems, dimmedIds, matchedIds, emphCount } = useMemo(() => {
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
    // How many of the audience-fit pool also match the chosen topic chips — the
    // number the topics actually move (they emphasise within the pool, don't shrink it).
    const emphCount = boostMatch ? matched.filter((a) => boostMatch(a)).length : 0;
    return { sortedItems: [...matched, ...dimmed], dimmedIds: new Set(dimmed.map((a) => a.id)), matchedIds: matched.map((a) => a.id), emphCount };
  }, [listItems, sort, cityTasteTagged, taste, profile.dislikes, selectedOnly, soloInterest, audience, boostMatch]);

  // Header counts = the audience-fit POOL, computed straight from all attractions —
  // deliberately IGNORING the view filters (רק אתרי חובה / search / flags) so toggling
  // a display filter never moves the number (it's "how many fit you", not "how many are
  // shown"). Standalone only (area members are counted inside their neighbourhood).
  const poolStats = useMemo(() => {
    if (!audience) return { total: 0, emph: 0 };
    let total = 0, emph = 0;
    for (const a of attractions) {
      if (allAreaMemberIds.has(a.id)) continue;
      if (audienceFit(a, audience) < AUDIENCE_FIT_FLOOR) continue;
      if (profile.dislikes.some((it) => matchesInterest(a, it))) continue;
      total++;
      if (boostMatch && boostMatch(a)) emph++;
    }
    return { total, emph };
  }, [attractions, audience, profile.dislikes, boostMatch, allAreaMemberIds]);

  // How many of the attractions the system actually put IN the trip (the pre-marked
  // ❤) match the chosen topics — the honest "your emphasis added N places" number,
  // NOT how many such places exist city-wide. Includes ones pulled beyond the browse
  // list (interest venues), as long as they were marked.
  const emphInTrip = useMemo(() => {
    if (!boostMatch) return 0;
    let n = 0;
    for (const a of attractions) if (choices[a.id] === "yes" && boostMatch(a)) n++;
    return n;
  }, [attractions, choices, boostMatch]);

  // Paginate: show PAGE at a time; reset to page 1 on any change.
  useEffect(() => { setVisibleCount(PAGE); }, [query, mustOnly, flags, mapOnly, sort, selectedOnly, soloInterest, profile.interests, profile.dislikes, audience, boosts, cityTab, areaTab]);
  // Never leave the traveler stranded in an empty "selected only" view.
  useEffect(() => { if (selectedOnly && yesCount + streetPicks.size === 0) setSelectedOnly(false); }, [selectedOnly, yesCount, streetPicks]);
  const visible = sortedItems.slice(0, visibleCount);
  const firstDimId = visible.find((a) => dimmedIds.has(a.id))?.id;
  // One unified list in every mode — audience is folded into the matched split
  // above (no separate curated screen).
  const displayItems = visible;
  const mode: "choose" | "short" = audience ? "short" : "choose";
  // Require at least one "אוהבים" topic before building — otherwise everyone with the
  // same audience gets the identical trip. Gates the build CTA + reveals step ③.
  // Editorial has no funnel: audience is pre-set, so building unlocks the moment ANYTHING
  // is hearted — a topic, a neighbourhood, or a specific place.
  const readyToBuild = editorial
    ? (boosts.size > 0 || yesCount > 0 || audience === "families")   // any category ♥ (topic / "עם ילדים"), a place, or a neighbourhood
    : (!!audience && boosts.size > 0);
  // MANUAL flow: the build unlocks once ≥MANUAL_MIN places are marked (we don't know
  // the trip length yet, so a flat floor). GUIDED: audience + a topic.
  // Editorial: nothing is pre-marked, so the traveller must actively pick enough
  // places to fill the trip (days × pace) before we build — no lazy "all must-see"
  // default that makes every trip identical.
  // Picked places count attractions + explicitly-picked streets (a street is a stop).
  const pickedCount = yesCount + streetPicks.size;
  const canBuild = editorial ? (pickedCount >= buildCapacity) : (manual ? yesCount >= MANUAL_MIN : readyToBuild);
  // Floor of places needed before the build unlocks (for the CTA count + tooltip).
  const needToBuild = editorial ? buildCapacity : manual ? MANUAL_MIN : 0;
  // CTA suffix: while short of the floor, show progress (2/20); once buildable,
  // show the count of places chosen so far — "בנו לי טיול (21)".
  const buildCountSuffix = !canBuild && needToBuild > 0
    ? ` · ${pickedCount}/${needToBuild}`
    : pickedCount > 0 ? ` (${pickedCount})` : "";
  const buildTitle = canBuild ? ""
    : editorial ? `בחרו עוד ${Math.max(0, needToBuild - pickedCount)} מקומות לטיול (${pickedCount}/${needToBuild})`
    : manual ? `סמנו לפחות ${MANUAL_MIN} מקומות (סימנתם ${yesCount})`
    : !audience ? "קודם בחרו בשביל מי הטיול"
    : boosts.size === 0 ? "הדגישו לפחות תחום אחד שאתם אוהבים" : "";
  // Hearts are interactive only when picking makes sense: always in manual, and in
  // guided ONLY after the system has something to pre-mark (audience + a topic).
  // Editorial makes hearts the primary selection (♥ on tabs / neighbourhoods / cards),
  // so they're always live there — manual marks survive the preview merge either way.
  const heartsEnabled = manual || readyToBuild || editorial;
  // The list + map show in manual too (guided keeps them hidden until an audience is set).
  const showBrowse = manual || mode === "short";

  const belowLabel = audience
    ? `פחות מתאים ל${PROFILE_HE[audience]} — אפשר בכל זאת לסמן`
    : "מחוץ להעדפות שלכם — אפשר בכל זאת לסמן";
  // Governing topic chips this CITY can actually deliver — only offer a chip with
  // ≥2 matching places (so niche topics like חופים/פארקי שעשועים hide where the
  // city has none). Keeps the audience flow honest per destination.
  const govInterests = useMemo(
    () => GOVERNING_INTERESTS.filter((it) => attractions.filter((a) => matchesInterest(a, it.key)).length >= 2),
    [attractions]);
  // Editorial browse tabs: שכונות (if the city has any) then one per governing interest.
  const cityTabs = useMemo(() => [
    { key: "__all", label: "הכל", emoji: "🔎" },
    { key: "__must", label: "אתרי חובה", emoji: "⭐" },
    ...(areas.length ? [{ key: "__areas", label: "שכונות", emoji: "🏘️" }] : []),
    { key: "__kids", label: "עם ילדים", emoji: "👨‍👩‍👧" },
    ...govInterests.map((it) => ({ key: it.key, label: it.label, emoji: it.emoji })),
  ], [areas.length, govInterests]);
  // Sort a set of attractions the house way: must-see first, then photo'd, then rating.
  const mustFirst = (arr: Attraction[]) => [...arr].sort((a, b) =>
    (b.must_see === 1 ? 1 : 0) - (a.must_see === 1 ? 1 : 0) ||
    (b.image_url ? 1 : 0) - (a.image_url ? 1 : 0) ||
    (b.family_score ?? 0) - (a.family_score ?? 0));
  const activeArea = useMemo(() => areas.find((x) => x.id === areaTab) ?? areas[0] ?? null, [areas, areaTab]);
  // The active tab's attractions. A neighbourhood tab shows that area's members; an
  // interest tab shows every attraction matching it — INCLUDING area members (so a
  // museum in a neighbourhood is cross-listed under "מוזיאונים" too). Must-see first.
  const cityTabItems = useMemo(() => {
    if (cityTab === "__all") return mustFirst(attractions);
    if (cityTab === "__must") return mustFirst(attractions.filter((a) => a.must_see === 1));
    if (cityTab === "__kids") return mustFirst(attractions.filter((a) => matchesInterest(a, "ילדים")));
    if (cityTab === "__areas") {
      if (!activeArea) return [] as Attraction[];
      return mustFirst(activeArea.member_ids.map((id) => attrById.get(id)).filter((m): m is Attraction => !!m));
    }
    return mustFirst(attractions.filter((a) => matchesInterest(a, cityTab)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityTab, activeArea, attractions, attrById]);
  // Search is SCOPED to the active tab — typing in "מוזיאונים" searches only museums,
  // in a neighbourhood only that area; the "הכל" tab holds every attraction, so it's
  // where a city-wide search lives.
  const cityScoped = useMemo(() => {
    // "בטיול" (selectedOnly) overrides the category — show ONLY what's in the trip,
    // across the whole city, and nothing else.
    const base = selectedOnly ? mustFirst(attractions.filter((a) => choices[a.id] === "yes")) : cityTabItems;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((a) => `${a.name_he ?? ""} ${a.name_en} ${descriptor(a)}`.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityTabItems, query, selectedOnly, attractions, choices]);
  const cityGridItems = cityScoped.slice(0, visibleCount);
  // "נקה" is context-aware: remove from the trip only the in-trip attractions
  // currently VISIBLE (the active category/search), not every pick in the city.
  const visibleTripIds = useMemo(() => cityScoped.filter((a) => choices[a.id] === "yes").map((a) => a.id), [cityScoped, choices]);
  const clearVisible = () => { if (visibleTripIds.length) setMany(visibleTripIds, null); };
  const cityTabLabel = cityTab === "__areas" ? (activeArea?.name_he || activeArea?.name_en || "שכונה")
    : (cityTabs.find((t) => t.key === cityTab)?.label ?? "");
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
  // The neighbourhood ❤ is ONE clear on/off toggle. "On" = the area is chosen (guided
  // area-day) OR any of its members is picked — the same signal the filled heart shows.
  // Clicking a FILLED heart therefore turns EVERYTHING off (clears the member picks AND
  // un-chooses the area), so it never stays stuck lit; clicking an empty one marks all
  // members (and, in guided, also gives the area its guaranteed day). WYSIWYG-safe: in
  // manual the picks ARE the trip; chosenAreas is only touched in guided.
  const toggleAreaHeart = (id: number) => {
    const area = areas.find((a) => a.id === id);
    if (!area) return;
    const ids = area.member_ids.filter((mid) => attrById.has(mid));   // only the members actually shown
    const on = chosenAreas.has(id) || ids.some((mid) => choices[mid] === "yes");
    if (on) {
      if (ids.length) setMany(ids, null);
      setChosenAreas((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
    } else {
      if (ids.length) setMany(ids, "yes");
      if (!manual) setChosenAreas((s) => new Set(s).add(id));
    }
  };

  // ── Server preview: once an audience + topics are set, ask the engine which
  // attractions it would actually put in the trip and pre-mark their ❤ — so the
  // traveller SEES the system's picks and can add/remove before building. Debounced;
  // runs a real (throwaway) build so the marks match exactly what "בנו לי טיול" picks.
  const autoPickRef = useRef<Set<number>>(new Set());
  // While the preview recomputes, the list below fades out → in, so a topic click
  // reads as "we're re-choosing your places" rather than an abrupt jump.
  const [previewing, setPreviewing] = useState(false);
  const boostsKey = [...boosts].sort().join(",");
  const areasKey = [...chosenAreas].sort().join(",");
  // Editorial pre-marks every must-see ❤ on entry (they're "חובה"); keeping them OUT of
  // the preview's auto-pick set means clearing topics never un-marks them.
  const mustSeeSet = useMemo(() => new Set(editorial ? attractions.filter((a) => a.must_see === 1).map((a) => a.id) : []), [attractions, editorial]);
  useEffect(() => {
    if (!selLoaded) return;   // wait for the saved marks to load before touching them
    if (manual) { setPreviewing(false); return; }   // manual: the user owns every mark — never auto-clear/pre-mark
    if (!audience) {
      // Fresh / "choose" mode: wipe ALL of this city's marks. They only exist because
      // of an audience-driven auto-pick — nothing legit is marked before an audience is
      // picked — so a new visit (or refresh) always starts clean, incl. old orphans.
      if (Object.values(choices).some((c) => c === "yes")) clear();
      autoPickRef.current = new Set();
      setPreviewing(false);
      return;
    }
    if (boosts.size === 0) {
      // audience but no topics → drop just the system's auto-marks, keep manual ones.
      if (autoPickRef.current.size) { setMany([...autoPickRef.current], null); autoPickRef.current = new Set(); }
      setPreviewing(false);
      return;
    }
    let cancelled = false;
    setPreviewing(true);   // fade the list out immediately on a topic/audience change
    const t = setTimeout(async () => {
      try {
        const buildTaste: Record<string, number> = { ...taste };
        for (const k of boosts) for (const tg of (INTEREST_TASTE[k] ?? [])) buildTaste[tg] = (buildTaste[tg] ?? 0) + 3;
        const areaList = areas.filter((a) => chosenAreas.has(a.id));
        const res = await fetch("/api/itinerary", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "generate", city: dest.city, days: buildDays, month: new Date().getMonth() + 1,
            taste: buildTaste, isFamily: profile.kids.length > 0 || audience === "families",
            pace: String(perDay), walkPref: profile.walkPref, interests: [...boosts], audience,
            ...(areaList.length ? { areaGroups: areaList.map((a) => a.member_ids), areaIds: areaList.map((a) => a.id) } : {}) }) });
        const data = await res.json().catch(() => null);
        if (cancelled || !data?.itinerary) return;
        const ids = new Set<number>();
        for (const d of data.itinerary.days ?? [])
          for (const s of d.stops ?? [])
            if (s.id != null && attrById.has(s.id)) ids.add(s.id);
        const stale = [...autoPickRef.current].filter((id) => !ids.has(id));
        if (stale.length) setMany(stale, null);
        if (ids.size) setMany([...ids], "yes");
        // keep must-see out of the auto-pick set so they stay ❤ when topics change
        autoPickRef.current = new Set([...ids].filter((id) => !mustSeeSet.has(id)));
      } catch { /* preview is best-effort */ } finally { if (!cancelled) setPreviewing(false); }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, boostsKey, areasKey, buildDays, dest.city, selLoaded, manual]);
  // NOTE: we deliberately DON'T pre-mark must-sees on entry anymore — starting with
  // everything selected made travellers lazy and every trip identical. Entry starts
  // empty; the traveller picks what they want (must-sees are badged ⭐ to guide them),
  // and the build unlocks once they've chosen enough (days × pace).
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
    // Manual build = the marks ARE the trip; send no interests/audience so the server
    // takes the strict WYSIWYG selection path (governed=false) and nothing un-picked enters.
    const chosenInterests = manual ? [] : (boosts.size ? [...boosts] : (profile.interests ?? []));
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
      profile: { ...profile, pace: String(perDay), taste: buildTaste, dailyDriveHours: RADIUS_HOURS[buildRadius] },
      ...(chosenInterests.length ? { interests: chosenInterests } : {}),
      ...(audience ? { audience } : {}),
      ...(yesFinal.length || noFinal.length ? { selection: { yes: yesFinal, no: noFinal } } : {}),
      ...(chosenAreaGroups.length ? { areaGroups: chosenAreaGroups, areaIds: chosenAreaIds } : {}),
      ...(streetPicks.size ? { streetIds: [...streetPicks] } : {}),
    });
    router.push(`/trip/${trip.id}?build=1`);
  }

  // Hoisted so editorial can place them in a full-width bar above BOTH columns
  // (tabs on top, search below); classic keeps the search inside the list column.
  const searchBarEl = (
          <div className="flex flex-wrap items-center gap-2 pt-3">
            {/* live search — filters as you type; ✕ clears */}
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
              <Search size={16} className="shrink-0 text-[var(--text-3)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={editorial ? (cityTab === "__all" ? "חיפוש בכל האטרקציות בעיר…" : `חיפוש בתוך "${cityTabLabel}"…`) : "חיפוש אטרקציה, שכונה או סוג מקום…"}
                className="flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-[var(--text-3)]" />
              {query && (
                <button onClick={() => setQuery("")} aria-label="נקה חיפוש" className="shrink-0 text-[var(--text-3)] transition hover:text-[var(--text)]">
                  <X size={16} />
                </button>
              )}
            </div>
            {/* clear (brand-orange) — removes from the trip ONLY the in-trip attractions
                visible under the current category/search, not every pick. */}
            {visibleTripIds.length > 0 && (
              <button onClick={clearVisible} title="הסר מהטיול את מה שמופיע כאן"
                className="flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition hover:bg-[var(--accent-soft)]"
                style={{ borderColor: "var(--accent)", color: "var(--accent-ink)", background: "var(--surface)" }}>
                <X size={14} /> נקה · {visibleTripIds.length}
              </button>
            )}
            {/* "רק אתרי חובה" sits with the sort/filters controls; default OFF so the
                browse opens on ALL attractions once an audience is picked. */}
            {!editorial && !soloInterest && !selectedOnly && (
              <button onClick={() => setMustOnly((v) => !v)} aria-pressed={mustOnly}
                className="flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition"
                style={{ background: mustOnly ? "var(--brand)" : "var(--surface)", color: mustOnly ? "#fff" : "var(--text-2)",
                         borderColor: mustOnly ? "var(--brand)" : "var(--border)" }}>
                <span>⭐ רק אתרי חובה</span>
                <span className={mustOnly ? "text-white/80" : "text-[var(--text-3)]"}>{mustSeeCount}</span>
                {mustOnly && <Check size={14} />}
              </button>
            )}
          </div>
  );
  // One category-tab pill — used across the three tag rows.
  const renderTab = (t: { key: string; label: string; emoji: string }) => {
    const active = cityTab === t.key;
    const count = t.key === "__all" ? attractions.length
      : t.key === "__must" ? attractions.filter((a) => a.must_see === 1).length
      : t.key === "__areas" ? areas.length
      : t.key === "__kids" ? attractions.filter((a) => matchesInterest(a, "ילדים")).length
      : attractions.filter((a) => matchesInterest(a, t.key)).length;
    const isKids = t.key === "__kids";
    const isInterest = t.key !== "__must" && t.key !== "__areas" && t.key !== "__all" && !isKids;
    const hasHeart = isInterest || isKids;
    const boosted = isKids ? audience === "families" : (isInterest && boosts.has(t.key));
    return (
      <div key={t.key}
        className="flex shrink-0 items-center overflow-hidden rounded-full border shadow-[var(--shadow)] transition"
        style={active ? { background: "var(--brand)", borderColor: "transparent", color: "#fff" }
          : boosted ? { background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent-ink)" }
          : { background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-2)", boxShadow: "none" }}>
        <button onClick={() => setCityTab(t.key)}
          className={`flex items-center gap-1.5 py-1.5 ps-3.5 text-[13.5px] font-medium ${hasHeart ? "pe-1.5" : "pe-3.5"}`}>
          <span aria-hidden>{t.emoji}</span> {t.label}
          <span className={`text-[11.5px] ${active || boosted ? "opacity-80" : "opacity-60"}`}>{count}</span>
        </button>
        {hasHeart && (
          <button onClick={(e) => { e.stopPropagation();
              if (isKids) setAudience(audience === "families" ? "adults" : "families");
              else setBoosts((s) => { const n = new Set(s); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; }); }}
            aria-pressed={boosted}
            title={isKids ? (boosted ? "בטלו התאמה לילדים" : "התאימו את הטיול לטיול עם ילדים") : (boosted ? "בטלו הדגשה" : "הדגישו — יסומן אוטומטית בטיול")}
            className="grid size-8 shrink-0 place-items-center pe-1.5"
            style={{ color: active ? "#fff" : boosted ? "var(--accent)" : "var(--text-3)" }}>
            <Heart size={15} fill={boosted ? "currentColor" : "none"} />
          </button>
        )}
      </div>
    );
  };
  // The three trip settings, pulled OUT of the build modal to sit above the
  // browse tabs — always visible, three fields to set before "בנו לי טיול"
  // (defaults are today's values, so doing nothing still works).
  const tripSettingsEl = (
    <div>
      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:gap-5">
      <div className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-3 lg:w-[70%]">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[13px]">
            <span className="font-medium text-[var(--text-2)]">כמה ימים?</span>
            <span className="font-semibold text-[var(--brand-ink)]">{buildDays}</span>
          </div>
          <input type="range" min={2} max={7} value={buildDays} dir="ltr" aria-label="כמה ימים"
            onChange={(e) => setBuildDays(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[13px]">
            <span className="font-medium text-[var(--text-2)]">מרחק נסיעה ליום</span>
            <span className="font-semibold text-[var(--brand-ink)]">{RADIUS_HE[buildRadius]}</span>
          </div>
          <input type="range" min={0} max={3} value={buildRadius} dir="ltr" aria-label="מרחק נסיעה ליום"
            onChange={(e) => setBuildRadius(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[13px]">
            <span className="font-medium text-[var(--text-2)]">קצב הטיול</span>
            <span className="font-semibold text-[var(--brand-ink)]">~{perDay} אטרקציות ביום</span>
          </div>
          <input type="range" min={PER_DAY_MIN} max={PER_DAY_MAX} value={perDay} dir="ltr" aria-label="אטרקציות ביום"
            onChange={(e) => setPerDay(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
        </div>
      </div>
      {/* the build CTA lives with the settings it depends on — 30% of the bar */}
      <div className="lg:w-[30%]">
        <span className={`inline-flex w-full rounded-full ${canBuild ? "pulse-attn-accent" : ""}`}>
          <button onClick={() => openBuild()} disabled={!canBuild} title={buildTitle}
            className="flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-3 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed"
            style={canBuild ? { background: "var(--accent)", boxShadow: "0 4px 12px rgba(198,79,38,.28)" } : { background: "var(--surface-2)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
            <Sparkles size={16} /> בנו לי טיול{buildCountSuffix}
          </button>
        </span>
      </div>
      </div>
    </div>
  );

  const cityTabsEl = (
    <>
          {/* browse tags in THREE rows on 80% of the width; the primary action
              buttons on the left 20%. row 1 = הכל / אתרי חובה · row 2 = the highlight (♥)
              tags · row 3 = שכונות, with its neighbourhood sub-tabs opening below it. */}
          <div className="pt-2 lg:flex lg:items-start lg:gap-4">
            <div className="flex min-w-0 flex-col gap-1.5 lg:w-4/5">
              {/* explainer for the ♥ flow — lives INSIDE the 80% column so it aligns with
                  the tabs and doesn't stretch the full page width. */}
              <p className="mb-0.5 rounded-[13px] bg-[var(--accent-soft)] px-4 py-3 text-[14.5px] font-medium leading-relaxed text-[var(--text)] shadow-[var(--shadow)]">
                סמנו ב־<span className="inline-flex translate-y-0.5 items-center font-semibold text-[var(--accent-ink)]"><Heart size={14} fill="currentColor" /></span> את המקומות שתרצו בטיול — אתרי החובה <span className="text-[var(--accent-ink)]">⭐</span> מסומנים בכוכב כהמלצה, אבל אתם בוחרים מה נכנס. בחרו לפחות <b>{buildCapacity}</b> ({buildDays} ימים × הקצב), ואז “בנו לי טיול”.
              </p>
              <div className="flex flex-wrap gap-2">
                {cityTabs.filter((t) => t.key === "__all" || t.key === "__must").map(renderTab)}
              </div>
              <div className="flex flex-wrap gap-2">
                {cityTabs.filter((t) => t.key !== "__all" && t.key !== "__must" && t.key !== "__areas").map(renderTab)}
              </div>
              <div className="flex flex-wrap gap-2">
                {cityTabs.filter((t) => t.key === "__areas").map(renderTab)}
              </div>
              {/* neighbourhood sub-tabs open directly under "שכונות" */}
              {cityTab === "__areas" && areas.length > 0 && (
                <>
                  <div className="mt-0.5 flex flex-wrap gap-2">
                    {areas.map((area) => {
                      const active = (activeArea?.id ?? null) === area.id;
                      const toured = chosenAreas.has(area.id);
                      return (
                        <div key={area.id}
                          className={`flex shrink-0 items-center overflow-hidden rounded-full border transition ${active ? "border-transparent ring-1 ring-[var(--brand)]" : toured ? "border-[var(--accent)]" : "border-[var(--border)] shadow-[var(--shadow)]"}`}
                          style={active ? { background: "var(--brand-soft)" } : toured ? { background: "var(--accent-soft)" } : { background: "var(--surface)" }}>
                          <button onClick={() => setAreaTab(area.id)}
                            className={`py-1 ps-3 pe-1 text-[12.5px] font-medium ${active ? "text-[var(--brand-ink)]" : "text-[var(--text-3)] hover:text-[var(--brand-ink)]"}`}>
                            {area.name_he || area.name_en} <span className="opacity-60">{area.member_ids.length}</span>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); toggleAreaHeart(area.id); }} disabled={!heartsEnabled}
                            aria-pressed={toured} title={heartsEnabled ? "טיילו בכל השכונה" : "בחרו קהל ותחום קודם"}
                            className="grid size-7 shrink-0 place-items-center pe-1.5 disabled:opacity-40"
                            style={{ color: toured ? "var(--accent)" : "var(--text-3)" }}>
                            <Heart size={13} fill={toured ? "currentColor" : "none"} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {activeArea?.vibe_he && (
                    <p className="mt-1 px-1 text-[13px] leading-snug text-[var(--text-2)]">{activeArea.vibe_he}</p>
                  )}
                  {/* the active neighbourhood's streets — pick one to add it to the trip */}
                  {activeArea && (streetsByArea.get(activeArea.id)?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium text-[var(--text-3)]">🛣️ רחובות בשכונה:</span>
                      {streetsByArea.get(activeArea.id)!.map((s) => (
                        <StreetPill key={s.id} s={s} picked={streetPicks.has(s.id)} onToggle={() => toggleStreet(s.id)} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* left 20% — the primary actions, stacked. Pass/community badges sit on top. */}
            <div className="mt-3 flex flex-wrap gap-2 lg:mt-0 lg:w-1/5 lg:flex-col">
              {passes.length > 0 && (
                <button onClick={() => setShowPasses((v) => !v)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-full border border-[var(--brand)] bg-[var(--surface)] px-3 py-2 text-[12.5px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-soft)]">
                  💳 כרטיס חוסך כסף {showPasses ? "▴" : "▾"}
                </button>
              )}
              {communityCount > 0 && (
                <Link href={`/destination/${dest.id}/trips`}
                  className="flex flex-1 items-center justify-center gap-1 rounded-full border border-[#ff5a5f]/40 bg-[#ff5a5f]/8 px-3 py-2 text-[12.5px] font-medium text-[#d63d42] transition hover:bg-[#ff5a5f]/15">
                  ❤️ {communityCount} טיולים
                </Link>
              )}
              <button onClick={toggleSelectedOnly} disabled={yesCount === 0}
                className="flex-1 rounded-full border px-3 py-2 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: selectedOnly ? "var(--brand)" : "var(--surface)", color: selectedOnly ? "#fff" : "var(--brand-ink)", borderColor: "var(--brand)" }}>
                {selectedOnly ? "הצג הכל" : "הצג נבחרים"}
              </button>
              <button onClick={clearAllChoices} disabled={yesCount === 0}
                title="נקה את כל הסימונים ששמורים לעיר"
                className="flex flex-1 items-center justify-center gap-1 rounded-full border border-[var(--border)] px-3 py-2 text-[12.5px] text-[var(--text-3)] transition hover:border-[#c0453f] hover:text-[#c0453f] disabled:cursor-not-allowed disabled:opacity-40">
                <X size={13} /> נקה
              </button>
              <span className={`inline-flex flex-1 rounded-full ${canBuild ? "pulse-attn-accent" : ""}`}>
                <button onClick={() => openBuild()} disabled={!canBuild} title={buildTitle}
                  className="flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed"
                  style={canBuild ? { background: "var(--accent)", boxShadow: "0 4px 12px rgba(198,79,38,.28)" } : { background: "var(--surface-2)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                  <Sparkles size={15} /> בנו לי טיול{buildCountSuffix}
                </button>
              </span>
            </div>
          </div>
    </>
  );
  // One category row for the VERTICAL desktop menu (full-width, emoji · label · count · ♥).
  const renderTabRow = (t: { key: string; label: string; emoji: string }) => {
    // A category and "בטיול" are mutually exclusive — a category is active only
    // when the trip filter isn't, and picking one clears the other.
    const active = cityTab === t.key && !selectedOnly;
    const count = t.key === "__all" ? attractions.length
      : t.key === "__must" ? attractions.filter((a) => a.must_see === 1).length
      : t.key === "__areas" ? areas.length
      : t.key === "__kids" ? attractions.filter((a) => matchesInterest(a, "ילדים")).length
      : attractions.filter((a) => matchesInterest(a, t.key)).length;
    const isKids = t.key === "__kids";
    const isInterest = t.key !== "__must" && t.key !== "__areas" && t.key !== "__all" && !isKids;
    const hasHeart = isInterest || isKids;
    const boosted = isKids ? audience === "families" : (isInterest && boosts.has(t.key));
    const Icon = CAT_ICON[t.key];
    return (
      <div key={t.key} className="flex items-center overflow-hidden rounded-[10px] transition"
        style={active ? { background: "var(--brand)", color: "#fff" }
          : boosted ? { background: "var(--accent-soft)", color: "var(--accent-ink)" } : {}}>
        <button onClick={() => { setCityTab(t.key); setSelectedOnly(false); }}
          className="flex flex-1 items-center gap-2 px-2.5 py-2 text-right text-[13.5px] font-medium">
          <span aria-hidden className="grid w-5 place-items-center">
            {Icon ? <Icon size={16} strokeWidth={1.75} style={{ color: active ? "#fff" : boosted ? "var(--accent)" : "var(--brand)" }} /> : t.emoji}
          </span>
          <span className="flex-1 truncate opacity-0 transition-opacity duration-150 group-hover:opacity-100">{t.label}</span>
          <span className={`text-[11.5px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${active || boosted ? "" : "text-[var(--text-3)]"}`}>{count}</span>
        </button>
        {hasHeart && (
          <button onClick={(e) => { e.stopPropagation();
              if (isKids) setAudience(audience === "families" ? "adults" : "families");
              else setBoosts((s) => { const n = new Set(s); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; }); }}
            aria-pressed={boosted} title={isKids ? "התאמה לילדים" : "הדגישו תחום"}
            className="grid size-8 shrink-0 place-items-center pe-1.5"
            style={{ color: active ? "#fff" : boosted ? "var(--accent)" : "var(--text-3)" }}>
            <Heart size={14} fill={boosted ? "currentColor" : "none"} />
          </button>
        )}
      </div>
    );
  };
  // The right-hand category menu (desktop): categories as a vertical list, the
  // neighbourhood sublist, then the primary actions.
  const categoryMenuEl = (
    <div className="flex flex-col gap-0.5">
      {/* "בטיול" — a chip like every other category row; filters the grid to the
          attractions already in the trip. */}
      <button onClick={() => setSelectedOnly((v) => !v)} aria-pressed={selectedOnly}
        title="הצג רק מה שנבחר לטיול"
        className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-right text-[13.5px] font-medium transition"
        style={selectedOnly ? { background: "var(--brand)", color: "#fff" } : {}}>
        <span aria-hidden className="grid w-5 place-items-center">
          <Heart size={14} fill="currentColor" style={{ color: selectedOnly ? "#fff" : "var(--brand)" }} />
        </span>
        <span className="flex-1 truncate opacity-0 transition-opacity duration-150 group-hover:opacity-100">בטיול</span>
        <span className={`text-[11.5px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${selectedOnly ? "" : "text-[var(--text-3)]"}`}>{pickedCount}</span>
      </button>
      {cityTabs.filter((t) => t.key === "__all" || t.key === "__must").map(renderTabRow)}
      <div className="my-1 h-px bg-[var(--border)]" />
      {cityTabs.filter((t) => t.key !== "__all" && t.key !== "__must" && t.key !== "__areas").map(renderTabRow)}
      <div className="my-1 h-px bg-[var(--border)]" />
      {cityTabs.filter((t) => t.key === "__areas").map(renderTabRow)}
      {cityTab === "__areas" && areas.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-0.5 pe-2">
          {areas.map((area) => {
            const active = (activeArea?.id ?? null) === area.id;
            const toured = chosenAreas.has(area.id);
            return (
              <div key={area.id} className="flex items-center overflow-hidden rounded-[8px]"
                style={active ? { background: "var(--brand-soft)" } : toured ? { background: "var(--accent-soft)" } : {}}>
                <button onClick={() => setAreaTab(area.id)}
                  className="flex flex-1 items-center gap-1.5 px-2 py-1.5 text-right text-[12.5px]"
                  style={{ color: active ? "var(--brand-ink)" : "var(--text-3)" }}>
                  <span className="flex-1 truncate">{area.name_he || area.name_en}</span>
                  <span className="opacity-60">{area.member_ids.length}</span>
                </button>
                <button onClick={(e) => { e.stopPropagation(); toggleAreaHeart(area.id); }} disabled={!heartsEnabled}
                  aria-pressed={toured} title="טיילו בכל השכונה"
                  className="grid size-7 shrink-0 place-items-center disabled:opacity-40"
                  style={{ color: toured ? "var(--accent)" : "var(--text-3)" }}>
                  <Heart size={12} fill={toured ? "currentColor" : "none"} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {/* filters — free / indoor / with-insights / on-the-map. Icon-first (like the
          category rows) so the rail stays legible when collapsed to icons only. */}
      <div className="mt-3 flex flex-col gap-0.5 border-t border-[var(--border)] pt-3">
        <p className="whitespace-nowrap px-2.5 pb-0.5 text-[11.5px] font-semibold text-[var(--text-3)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">סינון</p>
        {(([["free", "חינם", Coins], ["indoor", "מקורה", Umbrella],
           ...(isFamily ? [["top", "מומלץ למשפחות", Baby]] : []),
           ["withInsights", "עם תובנות מטיילים", MessageCircle]]) as [keyof typeof flags, string, LucideIcon][]).map(([k, label, Icon]) => (
          <button key={k} onClick={() => toggleFlag(k)} aria-pressed={flags[k]} title={label}
            className="flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-right text-[13px] transition"
            style={flags[k] ? { background: "var(--brand-soft)", color: "var(--brand-ink)", fontWeight: 600 } : { color: "var(--text-2)" }}>
            <span aria-hidden className="grid w-5 shrink-0 place-items-center">
              <Icon size={15} strokeWidth={1.75} style={{ color: flags[k] ? "var(--brand)" : "var(--text-3)" }} />
            </span>
            <span className="flex-1 truncate opacity-0 transition-opacity duration-150 group-hover:opacity-100">{label}</span>
            <span className="text-[11.5px] text-[var(--text-3)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">{flagCount[k]}</span>
            {flags[k] && <Check size={13} className="shrink-0 text-[var(--brand)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />}
          </button>
        ))}
        <button onClick={() => setMapOnly((v) => !v)} aria-pressed={mapOnly} title="רק מה שעל המפה"
          className="flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-right text-[13px] transition"
          style={mapOnly ? { background: "var(--brand-soft)", color: "var(--brand-ink)", fontWeight: 600 } : { color: "var(--text-2)" }}>
          <span aria-hidden className="grid w-5 shrink-0 place-items-center">
            <MapPin size={15} strokeWidth={1.75} style={{ color: mapOnly ? "var(--brand)" : "var(--text-3)" }} />
          </span>
          <span className="flex-1 truncate opacity-0 transition-opacity duration-150 group-hover:opacity-100">רק מה שעל המפה</span>
          {mapOnly && <Check size={13} className="shrink-0 text-[var(--brand)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />}
        </button>
      </div>
      {/* primary actions — hidden when the rail is collapsed to icons */}
      <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {passes.length > 0 && (
          <button onClick={() => setShowPasses((v) => !v)}
            className="flex items-center justify-center gap-1 rounded-full border border-[var(--brand)] bg-[var(--surface)] px-3 py-2 text-[12.5px] font-medium text-[var(--brand-ink)] transition hover:bg-[var(--brand-soft)]">
            💳 כרטיס חוסך כסף {showPasses ? "▴" : "▾"}
          </button>
        )}
        {communityCount > 0 && (
          <Link href={`/destination/${dest.id}/trips`}
            className="flex items-center justify-center gap-1 rounded-full border border-[#ff5a5f]/40 bg-[#ff5a5f]/8 px-3 py-2 text-[12.5px] font-medium text-[#d63d42] transition hover:bg-[#ff5a5f]/15">
            ❤️ {communityCount} טיולים
          </Link>
        )}
      </div>
    </div>
  );
  return (
    <main className="mx-auto w-full max-w-[440px] pb-28 lg:max-w-none lg:pb-20">
      {isEditor && (
        <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-[#3d2c0a] px-4 py-1.5 text-center text-[12.5px] font-medium text-[var(--amber-fill)]">
          <span>✎ מצב עורך — דרגו כל אטרקציה: חשיבות (חובה / אולי / ממש לא) והתאמה לילדים. השינויים נשמרים מיד.</span>
        </div>
      )}
      {/* compact card hero — a small landscape thumbnail + flag/city + a
          personalized CTA (the trip page's hero language), so the map + list
          are reachable right away. Editorial hides this whole band: the city
          name + flag now sit next to the logo in the top nav, and the build
          controls live in the settings sub-bar. */}
      {!editorial && (
      <header className="rise px-5 pt-3 pb-2.5 lg:px-8 lg:pt-4 lg:pb-3">
        <div className="mx-auto max-w-[1600px]">
          {/* the top city section sits directly on the cream page background (no
              white card). Structured like the TRIP header: a horizontal identity
              (breadcrumb | title · places · badges) with the destination image on
              the far right spanning it, and the interests as a full-width row
              below — no divider between the image and the info to its left. */}
          <div className={`lg:relative ${editorial ? "" : "p-3.5 lg:p-4"}`}>
            {/* destination image — floats to the far right, same 160×105 landscape treatment
                as the trip page (the pr below reserves room so nothing runs under it) */}
            {!editorial && (
              <div className="hidden overflow-hidden rounded-[var(--radius-sm)] lg:absolute lg:top-3 lg:block lg:h-[105px] lg:w-[160px]"
                   style={{ insetInlineStart: "16px" }}>
                <CityPoster destinationId={dest.id} cityHe={dest.city_he || dest.city}
                  orientation="landscape" position="50% 45%" className="absolute inset-0 size-full" />
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {/* identity block (cleared of the floated image via pr): breadcrumb, big city
                  NAME, then a meta row — the mode toggle on the right (under the name) and the
                  "N places" count + pass/community badges pushed to the left. */}
              <div className={`flex flex-col gap-2 ${editorial ? "" : "lg:pr-[188px]"}`}>
                {/* breadcrumb + city name on ONE line (hidden in editorial — the hero carries them) */}
                {!editorial && (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <Link href="/" className="eyebrow inline-flex items-center gap-1 text-[var(--text-2)]">
                    <ChevronRight size={14} /> בית
                  </Link>
                  <span className="h-3.5 w-px bg-[var(--border)]" />
                  <h1 className="serif flex items-center gap-1.5 text-[26px] font-bold leading-tight lg:text-[30px]">
                    <span className="text-[0.72em]">{countryFlag(dest.country)}</span>
                    {dest.city_he || dest.city}
                  </h1>
                </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {/* flow toggle — GUIDED vs MANUAL. Editorial hides it: there's one flow
                      now (pick categories/attractions with ♥, then build from them). */}
                  {!editorial && (
                  <div className="flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
                    <button onClick={() => setManual(false)}
                      className="rounded-full px-3 py-1 text-[12.5px] font-semibold transition"
                      style={{ background: !manual ? "var(--brand)" : "transparent", color: !manual ? "#fff" : "var(--text-2)" }}>
                      🧭 מודרך
                    </button>
                    <button onClick={() => setManual(true)}
                      className="rounded-full px-3 py-1 text-[12.5px] font-semibold transition"
                      style={{ background: manual ? "var(--accent)" : "transparent", color: manual ? "#fff" : "var(--text-2)" }}>
                      ✍️ בנייה חופשית
                    </button>
                  </div>
                  )}
                  {/* actions — build (prominent) + show-selected + clear, pushed left,
                      ABOVE the places-count / badges meta row below. */}
                  <div ref={topCtaRef} className="flex items-center gap-2 ms-auto">
                    {/* editorial: these actions live in the bar's left 20% column instead */}
                    {!editorial && (<>
                    <button onClick={toggleSelectedOnly} disabled={yesCount === 0}
                      className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: selectedOnly ? "var(--brand)" : "var(--surface)",
                               color: selectedOnly ? "#fff" : "var(--brand-ink)", borderColor: "var(--brand)" }}>
                      {selectedOnly ? "הצג הכל" : "הצג נבחרים"}
                    </button>
                    <button onClick={clearAllChoices} disabled={yesCount === 0}
                      title="נקה את כל הסימונים ששמורים לעיר"
                      className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-[12.5px] text-[var(--text-3)] transition hover:border-[#c0453f] hover:text-[#c0453f] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-3)]">
                      <X size={13} /> נקה
                    </button>
                    <span className={`inline-flex rounded-full ${canBuild ? "pulse-attn-accent" : ""}`}>
                      <button onClick={() => openBuild()} disabled={!canBuild}
                        title={buildTitle}
                        className="flex items-center gap-1.5 rounded-full px-5 py-1.5 text-[13.5px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed"
                        style={canBuild
                          ? { background: "var(--accent)", boxShadow: "0 4px 12px rgba(198,79,38,.28)" }
                          : { background: "var(--surface-2)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                        <Sparkles size={15} /> בנו לי טיול{buildCountSuffix}
                      </button>
                    </span>
                    </>)}
                  </div>
                </div>
                {/* meta — places count + pass/community badges. Classic keeps it on its own
                    line below; editorial moves it up onto the actions row (above). */}
                {!editorial && (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-[13px] font-semibold text-[var(--text-2)]">
                    {dest.attraction_count.toLocaleString("he")} מקומות לגלות בעיר
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
                )}
              </div>

              {/* audience tabs — pick who the trip is for (families / couples&friends).
                  Editorial hides this whole step: the audience is pre-set (adults) and the
                  "עם ילדים" tab ♥ flips it to families — no 1-2-3 funnel. */}
              {!editorial && (
              <div className="flex flex-wrap items-center gap-2">
                {!manual && (
                  <>
                    <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--text-2)]">
                      <span className={`grid size-5 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-white ${!audience ? "pulse-attn" : ""}`}>1</span>
                      בשביל מי הטיול?
                    </span>
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
                  </>
                )}
                {manual && (
                  <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--accent-ink)]">
                    ✍️ בנייה חופשית — הטיול ייבנה בדיוק מהמקומות שתסמנו
                  </span>
                )}
              </div>
              )}

              {/* short mode — taste calibration + one-tap build, transparent (no card).
                  In editorial this row is REPLACED by a ♥ on each topic/neighbourhood tab. */}
              {!manual && mode === "short" && !editorial && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--text-2)]">
                      <span className={`grid size-5 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-white ${boosts.size === 0 ? "pulse-attn" : ""}`}>2</span>
                      הדגישו מה שאוהבים:
                    </span>
                    {/* select-all shortcut — leads the row: pick everything in one tap */}
                    {(() => {
                      const allOn = govInterests.length > 0 && govInterests.every((it) => boosts.has(it.key));
                      return (
                        <button onClick={() => setBoosts(allOn ? new Set() : new Set(govInterests.map((it) => it.key)))}
                          className="rounded-full border px-3 py-1 text-[12.5px] font-semibold transition"
                          style={{ background: allOn ? "var(--brand)" : "var(--surface)",
                                   color: allOn ? "#fff" : "var(--brand-ink)", borderColor: "var(--brand)" }}>
                          {allOn ? "✓ הכל" : "הכל"}
                        </button>
                      );
                    })()}
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
              {!manual && mode === "choose" && (
                <p className="text-[13px] text-[var(--text-3)]">בחרו למי הטיול — ונראה לכם את המקומות שהכי אהובים על אנשים כמוכם.</p>
              )}
            </div>
          </div>
        </div>
      </header>
      )}

      {/* neighbourhoods now render INSIDE the attractions list (as container rows) —
          see <NeighbourhoodRows> just above the list. */}

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
          restaurants, tours, day-trips) — from travelers, grouped by place.
          Hidden in editorial: it pushed the browse down; those tips already
          surface on each attraction card. */}
      {!editorial && placeGroups.length > 0 && (
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

      {/* editorial: full-width bar above the two columns — category tabs, then search.
          Mirror the flex's visibility: hidden on mobile until the browse opens, but always
          shown on desktop (lg overrides), so the tabs never disappear on wide screens. */}
      {editorial && (
        <>
          {/* secondary nav — the trip settings (days · distance · pace) + build CTA,
              a sub-menu stuck directly under the main top nav (desktop). Full-bleed
              surface with a bottom border so it reads as subordinate to the main nav.
              Sticky only on desktop: on mobile there's no top nav and this bar is tall
              (stacked sliders), so pinning it would cover the map strip below. */}
          <div className={`relative z-20 border-b border-[var(--border)] bg-[var(--surface)]/92 backdrop-blur-lg lg:sticky lg:top-[64px] ${showBrowse ? "" : "hidden lg:block"}`}>
            <div className="mx-auto max-w-[1600px] px-5 py-2.5 lg:px-8">
              {tripSettingsEl}
            </div>
          </div>
          {/* mobile keeps the horizontal category chips; desktop uses the right menu.
              The search moved INTO the middle (attractions) column below. */}
          <div className={`px-5 pt-1 lg:hidden ${showBrowse ? "" : "hidden"}`}>{cityTabsEl}</div>
        </>
      )}
      <div className={`lg:flex lg:items-start lg:gap-5 lg:ps-8 ${showBrowse ? "" : "hidden"}`}>
        {/* right column (desktop): the category menu as an ICON-ONLY rail that
            expands to the full labelled menu on hover. Only ~60px is reserved in
            the flow; the expanded panel is an overlay (absolute) so hovering it
            never reflows the middle attractions column — it just floats over it. */}
        <aside className="hidden lg:order-1 lg:block lg:w-[52px] lg:shrink-0">
          <div className="group lg:sticky lg:top-[140px]" style={{ height: "calc(100dvh - 168px)" }}>
            <div className="absolute start-0 top-0 z-20 w-[52px] overflow-hidden rounded-[14px] bg-[var(--surface)] transition-[width,box-shadow] duration-200 group-hover:w-[248px] group-hover:overflow-y-auto group-hover:border group-hover:border-[var(--border)] group-hover:shadow-[0_10px_34px_rgba(24,18,9,0.16)]"
                 style={{ maxHeight: "calc(100dvh - 168px)" }}>
              <div className="w-[248px] p-1.5">
                {categoryMenuEl}
              </div>
            </div>
          </div>
        </aside>
        {/* map — a narrow sticky rail on desktop (far side); full-width strip on mobile */}
        <div className={`relative sticky top-0 z-10 w-full overflow-hidden border-[var(--border)] transition-[height] duration-300 ${mapOpen ? "h-[240px] border-y" : "h-0"} lg:order-3 lg:!h-[calc(100dvh-156px)] lg:top-[140px] lg:w-[360px] lg:shrink-0 lg:border-y-0 lg:border-s`}>
          <MapClient attractions={editorial ? cityScoped : displayItems} center={[dest.lat, dest.lng]} selected={selected}
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
        <section id="picks" className="scroll-mt-[120px] px-5 lg:order-2 lg:min-w-0 lg:flex-1 lg:px-4 lg:pb-16">
          {/* search — scoped to this (attractions) column only */}
          {editorial && searchBarEl}
          {/* streets — matched by the search box, or the ones already picked. A street
              is its own entity; picking one adds it to the trip (streetIds). */}
          {(matchedStreets.length > 0 || streetPicks.size > 0) && (
            <div className="mb-4 mt-3 lg:mt-4">
              <p className="mb-2 text-[13px] font-semibold text-[var(--text-2)]">
                🛣️ רחובות{query.trim() ? ` · תוצאות ל"${query.trim()}"` : " שבחרתם"}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(matchedStreets.length ? matchedStreets : streets.filter((s) => streetPicks.has(s.id))).map((s) => (
                  <StreetCard key={s.id} s={s} picked={streetPicks.has(s.id)} expanded={openStreetId === s.id}
                    onToggle={() => toggleStreet(s.id)}
                    onOpen={() => setOpenStreetId((cur) => (cur === s.id ? null : s.id))} />
                ))}
              </div>
            </div>
          )}
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
              {!editorial && !soloInterest && !selectedOnly && (
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
              {mapOnly ? "אין מקומות באזור המפה הנוכחי — הקטינו זום או הזיזו"
                : matchedStreets.length > 0 ? "מצאנו רחוב שמתאים לחיפוש 🛣️ (למעלה) — אין אטרקציות בשם הזה"
                : "אין תוצאות לסינון הזה"}
            </p>
          )}

          {/* toolbar above the list — ALWAYS visible (the old explore-only sticky
              toolbar was retired). Live search + sort + filters on one row; the
              "רק אתרי חובה" tag + view toggle on the next. */}
          {!editorial && searchBarEl}

          {/* the audience-fit count lives down here (not next to the step labels). Shown
              only once the flow is complete (audience + ≥1 topic) so clearing the topics
              hides it too — same as clearing the audience. */}
          {/* Editorial hides this audience-pool line: it counted ALL neighbourhoods (not
              selected ones) and named the audience — both confusing now that the funnel is
              gone and the tab counts already show the numbers. */}
          {!editorial && !manual && readyToBuild && (
            <p className="mt-3 text-[13px] text-[var(--text-2)]" title={`המקומות הבודדים מחוץ לשכונות. עוד עשרות מקומות מקובצים בתוך ${areas.length} השכונות (שכל אחת היא אזור שלם). הצ'יפים מדגישים בתוך המאגר, לא מצמצמים אותו.`}>
              <b className="text-[var(--text)]">{poolStats.total}</b> מקומות בודדים
              {areas.length > 0 && <> {"+ "}<b className="text-[var(--brand-ink)]">{areas.length}</b> שכונות</>}
              {" "}מתאימים ל{PROFILE_HE[audience ?? "adults"]}
              {boosts.size > 0 && <> · <b className="text-[var(--accent-ink)]">{emphInTrip}</b> מודגשים בטיול לפי הבחירה שלכם</>}
            </p>
          )}

          {/* Transparency line — explains the ❤. Editorial moves this ABOVE the tabs
              (reworded), so it's hidden here. */}
          {!editorial && (
          <p className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2 text-[12.5px] leading-relaxed text-[var(--text-2)]">
            {manual ? (
              <>
                בבנייה חופשית סמנו <span className="inline-flex items-center gap-0.5 font-medium text-[var(--brand-ink)]"><Heart size={12} fill="currentColor" /></span> את המקומות שתרצו בטיול (לפחות {MANUAL_MIN}). היומן ייבנה <b>בדיוק</b> מהם — שום מקום לא-מסומן לא ייכנס.
                {" "}בבנק שבדף הטיול תמצאו את כל אתרי החובה <span className="text-[var(--accent-ink)]">⭐</span> להוספה בכל רגע.
              </>
            ) : (
              <>
                המקומות המסומנים <span className="inline-flex items-center gap-0.5 font-medium text-[var(--brand-ink)]"><Heart size={12} fill="currentColor" /></span> הם בדיוק מה שייכנס לטיול — בחרנו לכם אותם לפי הקהל, הנושאים והשכונות (כולל אתרי חובה <span className="text-[var(--accent-ink)]">⭐</span>).
                {" "}הוסיפו מקומות שאהבתם או הסירו כל אחד מהם, ואז "בנו לי טיול".
              </>
            )}
          </p>
          )}

          {/* the whole list fades out → in while the preview re-chooses, so a topic
              click reads as an active refresh, not an abrupt reshuffle. */}
          <div className="transition-opacity duration-300 ease-out" style={{ opacity: previewing ? 0.4 : 1 }}>
          {/* neighbourhoods lead the list as "container" rows (same row design) — a
              whole-area heart tours it, expand to like specific members. Hidden while
              searching (then their members surface as normal flat results). */}
          {!query && !editorial && (
            <NeighbourhoodRows areas={areas} chosenIds={chosenAreas} attrById={attrById}
              isPicked={(id) => choices[id] === "yes"}
              onToggleArea={toggleAreaHeart}
              onToggleMember={(id) => setChoice(id, "yes")}
              onFocus={(a) => { setAreaFocus({ lat: a.lat, lng: a.lng, n: Date.now() }); if (!mapOpen) setMapOpen(true); }}
              onMemberFocus={(m) => { setSelected(m); if (!mapOpen) setMapOpen(true); }}
              locked={!heartsEnabled} insights={insights} />
          )}

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
                    <HeartToggle liked={choice === "yes"} onClick={() => setChoice(a.id, "yes")} disabled={!heartsEnabled} />
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
                          {wikiUrl(a.info_sources) && (
                            <p className="mt-1.5 text-[12px]">
                              <a href={wikiUrl(a.info_sources)!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                className="font-medium text-[var(--blue)] hover:underline">קראו עוד בוויקיפדיה ↗</a>
                              <span className="text-[var(--text-3)]"> · CC BY-SA</span>
                            </p>
                          )}
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
          <>
          <div className="grid grid-cols-1 gap-4 pt-3 sm:grid-cols-2 lg:pt-4 xl:grid-cols-3">
            {cityGridItems.length === 0 && (
              <p className="col-span-full py-6 text-center text-[13.5px] text-[var(--text-3)]">
                {query.trim() ? `לא נמצאו תוצאות ל"${query.trim()}"${cityTab === "__all" ? "" : ` תחת "${cityTabLabel}" — נסו בטאב "הכל"`}.` : "אין כאן מקומות עדיין."}
              </p>
            )}
            {cityGridItems.map((a) => {
              const isSel = selected?.id === a.id;
              const cost = a.cost_level != null ? COST_HE[a.cost_level] : null;
              const dur = durationHe(a.duration_minutes);
              const cat = mergeCat(a.category);
              const insList = insights[a.id] ?? [];
              const tip = insList[0]?.text_he || a.tips_he;
              const choice = choices[a.id];
              return (
                <Fragment key={a.id}>
                {false && a.id === firstDimId && (
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
                  data-aid={a.id}
                  ref={isSel ? selCardRef : undefined}
                  onMouseEnter={() => setHoveredId(a.id)} onMouseLeave={() => setHoveredId((h) => (h === a.id ? null : h))}
                  className={`group flex scroll-mt-24 flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface)] text-right shadow-[var(--shadow)] transition hover:-translate-y-0.5 ${isSel ? "sm:col-span-2 xl:col-span-3" : ""}`}
                  style={{ borderColor: choice === "yes" || isSel ? "var(--brand)" : "var(--border)",
                           boxShadow: isSel ? "0 0 0 1.5px var(--brand)" : undefined }}>
                  {/* clickable body — selects the place and flies the map. A div (not a
                      <button>) so the action links can nest inside the text column, like
                      the trip card; a second click closes it. */}
                  <div role="button" tabIndex={0}
                    onClick={() => setSelected(isSel ? null : a)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(isSel ? null : a); } }}
                    className={`flex flex-1 cursor-pointer text-right ${isSel ? "flex-col sm:flex-row sm:items-stretch sm:min-h-[260px] sm:max-h-[58vh] lg:max-h-[calc((100dvh-164px)*0.8)]" : "flex-col"}`}>
                    <div className={`relative w-full overflow-hidden bg-[var(--surface-2)] ${isSel ? "aspect-[16/10] sm:aspect-auto sm:w-[44%] sm:shrink-0" : "aspect-[16/10]"}`}>
                      {a.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={isSel ? hiResImage(a.image_url, 1100) : bigImage(a.image_url, 400)} alt="" loading="lazy"
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
                    <div className={`flex min-w-0 flex-1 flex-col p-3 ${isSel ? "sm:min-h-0 sm:overflow-y-auto" : ""}`}>
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
                        <p className={`mt-1.5 text-[13px] italic leading-snug text-[var(--text-2)] ${isSel ? "" : "line-clamp-2"}`}>{a.tagline_he}</p>
                      )}
                      {isSel && a.description_he && (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">{a.description_he}</p>
                      )}
                      {/* when / dress / cost — the same practical meta line the trip card
                          shows, so the two cards read identically (same system) */}
                      {isSel && (a.best_time_he || a.dress_he || a.cost_level != null) && (
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-[var(--text-2)]">
                          {a.best_time_he && <span><span className="text-[var(--text-3)]">מתי: </span>{a.best_time_he}</span>}
                          {a.dress_he && <span><span className="text-[var(--text-3)]">לבוש: </span>{a.dress_he}</span>}
                          {a.cost_level != null && <span><span className="text-[var(--text-3)]">עלות: </span>{COST_HE[a.cost_level] ?? ""}</span>}
                        </div>
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
                      {/* action links — inside the text column, right under the paragraph
                          (same placement as the trip card). stopPropagation so a link tap
                          doesn't also toggle the card closed. */}
                      {isSel && (a.website || wikiUrl(a.info_sources) || (a.lat != null && a.lng != null)) && (
                        <>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {a.website && (
                              <a href={a.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--blue)]"><ExternalLink size={12} /> אתר רשמי</a>
                            )}
                            {wikiUrl(a.info_sources) && (
                              <a href={wikiUrl(a.info_sources)!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="התיאור מבוסס על ויקיפדיה · CC BY-SA"
                                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--blue)]"><ExternalLink size={12} /> קראו עוד בוויקיפדיה</a>
                            )}
                            {a.lat != null && a.lng != null && (
                              <a href={googleMapsPin(a.lat, a.lng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-2)]"><MapPin size={12} /> פתח במפה</a>
                            )}
                          </div>
                          {wikiUrl(a.info_sources) && (
                            <p className="mt-1.5 text-[11px] text-[var(--text-3)]">התיאור מוויקיפדיה · CC BY-SA</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {/* yes / no marks — the traveler's picks for this city.
                      RTL order: כן first (right), then לא. */}
                  <div className="border-t border-[var(--border)] p-2">
                    <LikeBtn liked={choice === "yes"} onClick={() => setChoice(a.id, "yes")} disabled={!heartsEnabled} />
                  </div>
                </div>
                </Fragment>
              );
            })}
          </div>
          </>
          )}
          </div>

          {/* one unified paginator for every mode (the list is one browse now) */}
          {(editorial ? visibleCount < cityScoped.length : visibleCount < sortedItems.length) && (
            <div className="mt-6 flex justify-center pb-4">
              <button onClick={() => setVisibleCount((v) => v + PAGE)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-6 py-2.5 text-[14px] font-medium text-[var(--brand-ink)] shadow-[var(--shadow)] transition hover:border-[var(--brand)]">
                הצג עוד · נותרו {(editorial ? cityScoped.length : sortedItems.length) - visibleCount}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* persistent build bar — the flow's finish line, always visible so the
          goal is unmistakable: mark attractions, then build. Progress fills
          toward the minimum; the CTA activates once there are enough picks. */}
      <div className={`fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 shadow-[0_-8px_20px_rgba(16,29,43,0.08)] lg:px-8 ${showBrowse && !topCtaVisible ? "" : "hidden"}`}>
        <div className="mx-auto max-w-[1600px]">
          <div className="flex items-center justify-end gap-3">
            <div className="flex shrink-0 items-center gap-2">
              {yesCount > 0 && (
                <>
                  <button onClick={toggleSelectedOnly}
                    className="hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition sm:flex"
                    style={{ background: selectedOnly ? "var(--brand)" : "var(--surface)",
                             color: selectedOnly ? "#fff" : "var(--brand-ink)",
                             borderColor: selectedOnly ? "var(--brand)" : "var(--brand)" }}>
                    {selectedOnly ? "הצג הכל" : "הצג נבחרים"}
                  </button>
                  <button onClick={clearAllChoices} title="נקה את כל הסימונים ששמורים לעיר"
                    className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-[12.5px] text-[var(--text-3)] transition hover:border-[#c0453f] hover:text-[#c0453f]">
                    <X size={13} /> נקה
                  </button>
                </>
              )}
              {/* mirrors the top build button — active once an audience AND at least one
                  topic are chosen. */}
              <span className={`inline-flex rounded-full ${canBuild ? "pulse-attn-accent" : ""}`}>
              <button onClick={() => openBuild()} disabled={!canBuild}
                title={buildTitle}
                className="flex items-center gap-1.5 rounded-full px-5 py-1.5 text-[13.5px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed"
                style={canBuild
                  ? { background: "var(--accent)", boxShadow: "0 4px 12px rgba(198,79,38,.28)" }
                  : { background: "var(--surface-2)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                <Sparkles size={15} /> בנו לי טיול{buildCountSuffix}
              </button>
              </span>
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
            {/* recap of the settings chosen above the tabs (the sliders live there now) */}
            <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--text-2)]">
              <span>📅 {buildDays} ימים</span>
              <span>🚗 {RADIUS_HE[buildRadius]}</span>
              <span>⚡ ~{perDay} אטרקציות ביום</span>
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
