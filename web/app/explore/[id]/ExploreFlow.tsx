"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight, ChevronLeft, ChevronDown, Heart, X, Check, HelpCircle, CloudRain,
  Star, Music, Shirt, Wine, Ticket, Drama, Image as ImageIcon,
  Landmark, Trees, UtensilsCrossed, Gem, Trophy, Baby, ExternalLink, Globe, Sparkles, Sun,
  type LucideIcon,
} from "lucide-react";
import { WhyFits, TravelersSay } from "@/components/Signature";
import { CategoryTile } from "@/components/CategoryTiles";
import { CityPoster } from "@/components/CityPoster";
import { MapArt } from "@/components/Illustrations";
import type { Attraction, Destination, Insight } from "@/lib/db";
import { useProfile, useTrips, MONTHS_HE, type FamilyProfile } from "@/lib/store";
import { deriveTaste, rankByTaste } from "@/lib/taste";
import {
  briefFor, seasonalWeather, categoriesFor, calibrate, attractionChips,
  whyItFits, attractionFacts, INSIGHT_KIND_HE, type CatCard,
} from "@/lib/explore";

const ICONS: Record<string, LucideIcon> = {
  Music, Shirt, Wine, Ticket, Drama, Image: ImageIcon, Landmark, Trees,
  UtensilsCrossed, Gem, Trophy, Baby, Star,
};

const RADIUS_HE = ["קרוב מאוד", "עד שעה", "עד שעתיים", "גם רחוק"];
const RADIUS_HOURS = [0.5, 1, 2, 3]; // slider index → per-trip dailyDriveHours
type Choice = "yes" | "maybe" | "no";

// Step 1 (board mock): who's travelling THIS trip — composition, kid ages, and
// interests — a per-trip draft over the global profile (locked decision 5).
const COMPS = ["זוג", "משפחה", "חברים", "עם ילדים"] as const;
type Comp = (typeof COMPS)[number];
const AGE_BANDS = ["0-3", "4-8", "9-12", "13+"] as const;
const BAND_AGE: Record<string, number> = { "0-3": 2, "4-8": 6, "9-12": 10, "13+": 14 };
const bandOf = (age: number) => (age <= 3 ? "0-3" : age <= 8 ? "4-8" : age <= 12 ? "9-12" : "13+");
const STEP1_INTERESTS = ["טבע", "אוכל", "תרבות", "קניות", "ספורט", "חופים",
  "פארקי שעשועים", "היסטוריה", "חיי לילה"];
const hasKids = (c: Comp) => c === "משפחה" || c === "עם ילדים";

export function ExploreFlow(
  { dest, attractions, insights = [] }:
  { dest: Destination; attractions: Attraction[]; insights?: Insight[] }
) {
  const router = useRouter();
  const [profile, , profileLoaded] = useProfile();
  const { create } = useTrips();

  const [step, setStep] = useState(1);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [comp, setComp] = useState<Comp>("זוג");                 // step-1: who's travelling
  const [bands, setBands] = useState<Set<string>>(new Set());    // step-1: kid age bands
  const [interests, setInterests] = useState<Set<string>>(new Set()); // step-1: trip interests
  const [likes, setLikes] = useState<Set<string>>(new Set());
  const [dislikes, setDislikes] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState(false);           // profile prefs pre-loaded?
  const [showProfilePrefs, setShowProfilePrefs] = useState(false); // collapsed loaded-prefs section
  const [sel, setSel] = useState<Record<number, Choice>>({});
  const [filt, setFilt] = useState<"all" | Choice>("all");       // step-3 status filter
  const [openCard, setOpenCard] = useState<number | null>(null); // step-3 expanded attraction
  const [days, setDays] = useState(4);
  const [radius, setRadius] = useState(1);

  // The per-trip traveler draft: step-1 edits layered over the global profile.
  // Saved onto the trip at build; the global profile is never touched.
  const draftProfile = useMemo<FamilyProfile>(() => ({
    ...profile,
    adults: comp === "חברים" ? 4 : 2,
    kids: hasKids(comp)
      ? [...bands].sort().map((b) => ({ name: "", age: BAND_AGE[b] ?? 8, loves: "" }))
      : [],
    interests: [...interests],
  }), [profile, comp, bands, interests]);

  // Verified traveller insights grouped by attraction (for the step-3 detail).
  const insightsById = useMemo(() => {
    const m = new Map<number, Insight[]>();
    for (const i of insights) {
      if (i.attraction_id == null) continue;
      const arr = m.get(i.attraction_id) ?? [];
      arr.push(i);
      m.set(i.attraction_id, arr);
    }
    return m;
  }, [insights]);

  const cityHe = dest.city_he ?? dest.city;
  const base = useMemo(() => deriveTaste(draftProfile), [draftProfile]);
  const calibrated = useMemo(() => calibrate(base, likes, dislikes), [base, likes, dislikes]);
  const cats = useMemo(() => categoriesFor(attractions, base, draftProfile, 12), [attractions, base, draftProfile]);

  // A category "comes from the profile" when the profile already weights it —
  // an interest (≥3) pre-likes it, a dislike (<0) pre-dislikes it. Baseline-only
  // tags (weight 1) are neutral.
  const fromProfile = (tag: string) => (base[tag] ?? 0) >= 3 || (base[tag] ?? 0) < 0;
  // Discovery nudge — categories that STAND OUT in this city (`hot`) that the
  // traveler didn't ask for. NOT "for you" (they never picked these); a gentle
  // "you might not have thought of it" push (locked decision 3). A non-profile
  // category that isn't hot is neither a preference nor special → not shown
  // (positive framing: we never surface "not for you").
  const discoverCats = useMemo(() => cats.filter((c) => !fromProfile(c.tag) && c.hot), [cats, base]);
  const profileCats = useMemo(() => cats.filter((c) => fromProfile(c.tag)), [cats, base]);

  // Seed the flow from the global profile once it hydrates: step-1 draft
  // (composition / ages / interests) + step-2 likes/dislikes. The user is
  // CALIBRATING loaded preferences, not starting blank. Runs once; later
  // navigation keeps their adjustments.
  useEffect(() => {
    if (!profileLoaded || seeded) return;
    setComp(profile.kids.length ? "עם ילדים" : profile.adults >= 3 ? "חברים" : "זוג");
    setBands(new Set(profile.kids.map((k) => bandOf(k.age))));
    setInterests(new Set(profile.interests));
    const b = deriveTaste(profile);
    setLikes(new Set(Object.keys(b).filter((t) => b[t] >= 3)));
    setDislikes(new Set(Object.keys(b).filter((t) => b[t] < 0)));
    setSeeded(true);
  }, [profileLoaded, seeded, profile]);
  const ranked = useMemo(() => rankByTaste(attractions, calibrated, 50), [attractions, calibrated]);
  const rankedIds = useMemo(() => new Set(ranked.map((a) => a.id)), [ranked]);
  const weather = seasonalWeather(month);
  const brief = briefFor(dest.city);

  // Only choices for attractions still visible in the (re-rankable) top-50 count
  // and get built — recalibrating in step 2 can drop items the user had marked.
  const visibleSel = useMemo(
    () => Object.entries(sel).filter(([id]) => rankedIds.has(Number(id))),
    [sel, rankedIds]
  );
  const yesCount = visibleSel.filter(([, v]) => v === "yes").length;
  const maybeCount = visibleSel.filter(([, v]) => v === "maybe").length;

  const rate = (tag: string, dir: "like" | "dislike") => {
    setLikes((prev) => {
      const n = new Set(prev);
      if (dir === "like") { n.has(tag) ? n.delete(tag) : n.add(tag); } else { n.delete(tag); }
      return n;
    });
    setDislikes((prev) => {
      const n = new Set(prev);
      if (dir === "dislike") { n.has(tag) ? n.delete(tag) : n.add(tag); } else { n.delete(tag); }
      return n;
    });
  };

  const renderCat = (c: CatCard) => {
    const Icon = ICONS[c.icon] ?? Star;
    const liked = likes.has(c.tag);
    const disliked = dislikes.has(c.tag);
    return (
      <div key={c.tag} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
        <Icon size={19} className="shrink-0 text-[var(--brand)]" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[14px] font-medium">
            {c.label_he}
            {c.hot && <span className="rounded-full bg-[var(--amber-soft)] px-1.5 py-0.5 text-[10px] text-[var(--amber)]">בולט</span>}
          </p>
          <p className="text-[12px] text-[var(--text-3)]">{c.vibe_he}</p>
        </div>
        <button onClick={() => rate(c.tag, "like")} aria-label="אהבתי"
          className="grid size-8 place-items-center rounded-full border transition"
          style={{ background: liked ? "var(--brand)" : "var(--surface)", color: liked ? "#fff" : "var(--text-3)", borderColor: liked ? "var(--brand)" : "var(--border)" }}>
          <Heart size={15} />
        </button>
        <button onClick={() => rate(c.tag, "dislike")} aria-label="פחות"
          className="grid size-8 place-items-center rounded-full border transition"
          style={{ background: disliked ? "var(--surface-2)" : "var(--surface)", color: disliked ? "var(--text-2)" : "var(--text-3)", borderColor: "var(--border)" }}>
          <X size={15} />
        </button>
      </div>
    );
  };

  const pick = (id: number, c: Choice) =>
    setSel((prev) => {
      if (prev[id] === c) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: c };
    });

  const build = () => {
    const yes: number[] = [], maybe: number[] = [], no: number[] = [];
    for (const [id, v] of visibleSel) {
      (v === "yes" ? yes : v === "maybe" ? maybe : no).push(Number(id));
    }
    const trip = create({
      title: `${cityHe} — חקירה`,
      mode: "preferences",
      city: dest.city,
      cityHe,
      country: dest.country,
      destinationId: dest.id,
      days,
      month,
      profile: { ...draftProfile, taste: calibrated, dailyDriveHours: RADIUS_HOURS[radius] },
      selection: { yes, maybe, no },
    });
    router.push(`/trip/${trip.id}`);
  };

  const next = () => setStep((s) => Math.min(4, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-8 lg:max-w-2xl lg:px-8 lg:pb-12">
      <Link href={`/destination/${dest.id}`} className="eyebrow mb-4 inline-flex items-center gap-1">
        <ChevronRight size={14} /> {cityHe}
      </Link>

      <header className="rise mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold leading-tight">חקירת יעד · {cityHe}</h1>
          <p className="text-[13px] text-[var(--text-2)]">נכיר את היעד לפי מי שאתם — ונבנה טיול</p>
        </div>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className="h-1.5 rounded-full transition-all"
              style={{ width: n === step ? 18 : 6, background: n === step ? "var(--brand)" : "var(--border)" }} />
          ))}
        </div>
      </header>

      {/* -------- Step 1: who's travelling THIS trip (board mock 1) -------- */}
      {step === 1 && (
        <section className="rise">
          <p className="eyebrow mb-2">שלב 1 · פרופיל</p>
          <div className="rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
            <h2 className="serif text-[20px] font-semibold">מי יוצא לטיול?</h2>
            <p className="mb-4 mt-0.5 text-[12.5px] text-[var(--text-3)]">זה יעזור לנו לבנות לכם טיול שמתאים בול לכם</p>

            <p className="mb-2 text-[14px] font-medium">מי נוסע?</p>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {COMPS.map((c) => (
                <SelChip key={c} on={comp === c} onClick={() => setComp(c)}>{c}</SelChip>
              ))}
            </div>

            {hasKids(comp) && (
              <>
                <p className="mb-2 text-[14px] font-medium">גילאי ילדים</p>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {AGE_BANDS.map((b) => (
                    <SelChip key={b} on={bands.has(b)}
                      onClick={() => setBands((prev) => { const n = new Set(prev); n.has(b) ? n.delete(b) : n.add(b); return n; })}>
                      {b}
                    </SelChip>
                  ))}
                </div>
              </>
            )}

            <p className="mb-2 text-[14px] font-medium">מה אתם אוהבים?</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {STEP1_INTERESTS.map((v) => (
                <CategoryTile key={v} label={v} selected={interests.has(v)}
                  onClick={() => setInterests((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; })} />
              ))}
            </div>

            <label className="flex items-center justify-between gap-2 text-[13px] text-[var(--text-2)]">
              מתי הטיול?
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] outline-none">
                {MONTHS_HE.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <p className="mt-3 text-[12px] text-[var(--text-3)]">
              הבחירות כאן שייכות לטיול הזה בלבד — הפרופיל הכללי לא משתנה.{" "}
              <Link href="/profile" className="underline">עריכת פרופיל</Link>
            </p>
          </div>
        </section>
      )}

      {/* -------- Step 2: macro + category like/dislike -------- */}
      {step === 2 && (
        <section className="rise">
          <p className="eyebrow mb-2 flex items-center gap-1"><Globe size={12} /> שלב 2 · היכרות עם {cityHe}</p>

          <div className="relative mb-3 overflow-hidden rounded-[var(--radius-card)]">
            <div className="absolute inset-0">
              <CityPoster destinationId={dest.id} cityHe={cityHe} ambient
                orientation="banner" position="50% 50%" className="size-full" />
            </div>
            <div className="relative flex min-h-[130px] flex-col justify-end p-4">
              <h2 className="serif text-[28px] font-bold leading-none text-[var(--text)]">{cityHe}</h2>
              <p className="text-[12.5px] text-[var(--text-2)]">{dest.country_he ?? dest.country}</p>
            </div>
          </div>

          <div className="mb-2 flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <CloudRain size={26} className="shrink-0 text-[var(--blue)]" />
            <div>
              <p className="text-[13px] font-medium">{MONTHS_HE[month - 1]} · {weather.he}</p>
              <p className="text-[12px] text-[var(--text-3)]">{weather.hint_he}</p>
            </div>
          </div>
          <p className="mb-1 text-[13px] leading-relaxed text-[var(--text-2)]">{brief.narrative_he}</p>
          {brief.history_he && <p className="mb-1 text-[12.5px] leading-relaxed text-[var(--text-3)]">{brief.history_he}</p>}
          {brief.language_he && <p className="mb-4 text-[12px] text-[var(--text-3)]">שפה: {brief.language_he}</p>}

          {/* Calibration framing: preferences are pre-loaded from the profile —
              the user only fine-tunes for THIS destination, and never touches the
              global profile (per-trip calibration, decision 5). */}
          <div className="mb-3 flex items-start gap-1.5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--brand-soft)] p-3 text-[12.5px] leading-relaxed text-[var(--brand-ink)]">
            <Sparkles size={15} className="mt-0.5 shrink-0" />
            <span>ההעדפות שלכם כבר טעונות מהפרופיל — כאן רק מכווננים ל{cityHe}. שנו רק מה שמיוחד ליעד. זה לא משנה את הפרופיל הכללי.</span>
          </div>

          {discoverCats.length > 0 && (
            <>
              <p className="mb-1 text-[15px] font-bold">שווה לגלות ב{cityHe}</p>
              <p className="mb-3 text-[12px] text-[var(--text-3)]">בולטים כאן — לא ביקשתם, אבל אולי תאהבו. סמנו מה שמסקרן.</p>
              <div className="flex flex-col gap-2">{discoverCats.map(renderCat)}</div>
            </>
          )}

          {profileCats.length > 0 && (
            <div className="mt-4">
              <button onClick={() => setShowProfilePrefs((v) => !v)}
                className="flex w-full items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-right">
                <Heart size={15} className="shrink-0 text-[var(--brand)]" fill="currentColor" />
                <span className="min-w-0 flex-1 text-[13px] text-[var(--text-2)]">
                  {profileCats.length} העדפות מהפרופיל שלכם כבר נכללות — הקישו לכוונון
                </span>
                <ChevronDown size={17} className={`shrink-0 text-[var(--text-3)] transition-transform ${showProfilePrefs ? "rotate-180" : ""}`} />
              </button>
              {showProfilePrefs && (
                <div className="mt-2 flex flex-col gap-2">{profileCats.map(renderCat)}</div>
              )}
            </div>
          )}
        </section>
      )}

      {/* -------- Step 3: taste-ranked attractions, 3-way -------- */}
      {step === 3 && (
        <section className="rise">
          <p className="eyebrow mb-2"><Star size={12} className="inline" /> שלב 3 · איך נשמע לכם?</p>
          <p className="mb-3 text-[12px] text-[var(--text-3)]">סמנו מה מתאים במיוחד — כן / אולי / לא.</p>
          {/* status filter (board mock 3): revisit what you marked */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {([
              { k: "all", label: "הכל" },
              { k: "yes", label: `כן${yesCount ? ` · ${yesCount}` : ""}` },
              { k: "maybe", label: `אולי${maybeCount ? ` · ${maybeCount}` : ""}` },
              { k: "no", label: "לא" },
            ] as { k: "all" | Choice; label: string }[]).map((f) => (
              <button key={f.k} onClick={() => setFilt(f.k)}
                className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition"
                style={filt === f.k
                  ? f.k === "maybe"
                    ? { background: "var(--amber-fill)", color: "var(--text)", border: "1.5px solid var(--amber-fill)" }
                    : f.k === "no"
                      ? { background: "var(--accent)", color: "#fff", border: "1.5px solid var(--accent)" }
                      : { background: "var(--brand)", color: "#fff", border: "1.5px solid var(--brand)" }
                  : { background: "var(--surface)", color: "var(--text-2)", border: "1.5px solid var(--border)" }}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            {ranked.filter((a) => filt === "all" || sel[a.id] === filt).map((a) => {
              const chips = attractionChips(a, calibrated);
              const c = sel[a.id];
              const open = openCard === a.id;
              const why = whyItFits(a, calibrated);
              const facts = attractionFacts(a);
              const notes = insightsById.get(a.id) ?? [];
              // full (unclamped) description for the expansion; skip if it just
              // repeats the one-line tagline already shown in the compact card.
              const desc = a.description_he && a.description_he !== a.tagline_he ? a.description_he : null;
              const hasMore = !!(why || desc || facts.length || notes.length);
              return (
                <div key={a.id} className="rounded-[var(--radius-card)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
                  {/* Board card language: portrait image on the inline-end side,
                      strong title, sun+fit-score (honest — our family_score, not
                      invented ratings), chips, and the 3-way choice. */}
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1">
                      <button type="button" disabled={!hasMore}
                        onClick={() => setOpenCard(open ? null : a.id)}
                        className="flex w-full items-start justify-between gap-2 text-right">
                        <span className="min-w-0">
                          <span className="serif block truncate text-[15.5px] font-semibold leading-tight">{a.name_he ?? a.name_en}</span>
                          {(a.tagline_he || a.description_he) && (
                            <span className="mt-0.5 block line-clamp-1 text-[12px] text-[var(--text-3)]">{a.tagline_he ?? a.description_he}</span>
                          )}
                        </span>
                        {hasMore && (
                          <ChevronDown size={16}
                            className={`mt-0.5 shrink-0 text-[var(--text-3)] transition-transform ${open ? "rotate-180" : ""}`} />
                        )}
                      </button>
                      {a.family_score != null && (
                        <span className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-[var(--amber)]">
                          <Sun size={14} fill="var(--amber-fill)" stroke="var(--amber-fill)" /> {a.family_score}/10 התאמה
                        </span>
                      )}
                      <div className="mb-1.5 mt-1 flex flex-wrap gap-1">
                        {chips.map((ch, i) => (
                          <span key={i} className="rounded-full px-1.5 py-0.5 text-[10.5px]"
                            style={
                              ch.kind === "nudge" ? { background: "var(--amber-soft)", color: "var(--amber)" }
                              : ch.kind === "must" ? { background: "var(--brand-soft)", color: "var(--brand-ink)" }
                              : { background: "var(--surface-2)", color: "var(--text-2)" }
                            }>{ch.label_he}</span>
                        ))}
                        {a.website && (
                          <a href={a.website} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-0.5 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-2)]">
                            קישור <ExternalLink size={9} />
                          </a>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <ChoiceBtn active={c === "yes"} onClick={() => pick(a.id, "yes")} tone="yes" icon={<Check size={13} />} label="כן" />
                        <ChoiceBtn active={c === "maybe"} onClick={() => pick(a.id, "maybe")} tone="maybe" icon={<HelpCircle size={13} />} label="אולי" />
                        <ChoiceBtn active={c === "no"} onClick={() => pick(a.id, "no")} tone="no" icon={<X size={13} />} label="לא" />
                      </div>
                    </div>
                    {/* portrait image, board-style (inline-end = left in RTL) */}
                    <div className="w-[86px] shrink-0 self-stretch overflow-hidden rounded-[12px] bg-[var(--brand-soft)]" style={{ minHeight: 104 }}>
                      {a.image_url
                        ? <img src={a.image_url} alt="" loading="lazy" className="size-full object-cover" />
                        : <span className="grid size-full place-items-center text-[var(--brand-ink)]"><ImageIcon size={22} /></span>}
                    </div>
                  </div>

                  {open && (
                    <div className="mt-2.5 flex flex-col gap-2 border-t border-[var(--border)] pt-2.5">
                      {why && <WhyFits>{why}</WhyFits>}
                      {desc && <p className="text-[12.5px] leading-relaxed text-[var(--text-2)]">{desc}</p>}
                      {facts.length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-2)]">
                          {facts.map((f, i) => (
                            <span key={i}><span className="text-[var(--text-3)]">{f.label_he}: </span>{f.value_he}</span>
                          ))}
                        </div>
                      )}
                      {notes.slice(0, 2).map((ins) => (
                        <TravelersSay key={ins.id} quote={ins.text_he} kind={INSIGHT_KIND_HE[ins.kind]} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-center text-[12px] text-[var(--text-3)]">בחרתם {yesCount} · אולי {maybeCount}</p>
        </section>
      )}

      {/* -------- Step 4: build -------- */}
      {step === 4 && (
        <section className="rise">
          <p className="eyebrow mb-2">שלב 4 · בונים טיול</p>
          <div className="mb-2 flex justify-center"><MapArt width={190} /></div>
          <h2 className="serif mb-4 text-center text-[20px] font-semibold">בונים לכם את הטיול המושלם</h2>
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-[13px] text-[var(--text-2)]">
              <span>כמה ימים?</span><span className="font-medium text-[var(--brand-ink)]">{days} ימים</span>
            </div>
            <input type="range" min={2} max={7} value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="w-full" style={{ accentColor: "var(--brand)" }} />
          </div>
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-[13px] text-[var(--text-2)]">
              <span>מרחק נסיעה ליום</span><span className="font-medium text-[var(--brand-ink)]">{RADIUS_HE[radius]}</span>
            </div>
            <input type="range" min={0} max={3} value={radius} onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full" style={{ accentColor: "var(--brand)" }} />
          </div>
          {/* what the builder takes into account (board mock 4) — all true */}
          <div className="rounded-[var(--radius-card)] bg-[var(--brand-soft)] p-4">
            <div className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-[var(--brand-ink)]">
              {["מתאים להעדפות ולכיול שסימנתם",
                "כל יום נפתח בעוגן שבחרתם ב״כן״ — וה״אולי״ משתלב אם יש זמן",
                `לפי מרחק הנסיעה שבחרתם (${RADIUS_HE[radius]})`,
                "מאוזן — עם הפסקות אוכל, מנוחה וקצב נכון"].map((t) => (
                <p key={t} className="flex items-start gap-1.5">
                  <Check size={15} className="mt-0.5 shrink-0" /> {t}
                </p>
              ))}
            </div>
          </div>
          <button onClick={build}
            className="mt-4 w-full rounded-full bg-[var(--brand)] py-3 text-[15px] font-medium text-white">
            בנו לי טיול
          </button>
          <p className="mt-2 text-center text-[11px] text-[var(--text-3)]">כל דירוג ובחירה מלמדים אותנו — ונשתפר לפרופילים דומים</p>
        </section>
      )}

      {/* -------- nav -------- */}
      {step < 4 && (
        <div className="mt-6 flex items-center justify-between">
          <button onClick={back} disabled={step === 1}
            className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-[var(--brand)] bg-[var(--surface)] px-4 py-2.5 text-[14px] font-medium text-[var(--brand-ink)] disabled:opacity-0">
            <ChevronRight size={15} /> חזרה
          </button>
          <button onClick={next}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--brand)] px-5 py-2.5 text-[14px] font-medium text-white">
            {step === 3 ? "לבניית הטיול" : "הבא"} <ChevronLeft size={15} />
          </button>
        </div>
      )}
    </main>
  );
}

// Small single/multi-select pill (step-1 composition + age bands).
function SelChip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-full px-3.5 py-1.5 text-[13px] font-medium transition"
      style={{
        background: on ? "var(--brand)" : "var(--surface)",
        color: on ? "#fff" : "var(--text-2)",
        border: `1.5px solid ${on ? "var(--brand)" : "var(--border)"}`,
      }}>
      {children}
    </button>
  );
}

function ChoiceBtn({ active, onClick, tone, icon, label }: {
  active: boolean; onClick: () => void; tone: "yes" | "maybe" | "no"; icon: React.ReactNode; label: string;
}) {
  // Board language: selected chips are FILLED — green / amber / terracotta.
  // Amber pairs with dark ink (white on amber fails AA).
  const on = {
    yes: { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" },
    maybe: { background: "var(--amber-fill)", color: "var(--text)", borderColor: "var(--amber-fill)" },
    no: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },
  }[tone];
  return (
    <button onClick={onClick}
      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-[12px] font-medium transition"
      style={active ? on : { background: "var(--surface)", color: "var(--text-3)", borderColor: "var(--border)" }}>
      {icon} {label}
    </button>
  );
}
