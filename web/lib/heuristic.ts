// Heuristic itinerary builder — a real day-by-day plan from DB attractions,
// WITHOUT Claude. Used as a fallback until ANTHROPIC_API_KEY is configured;
// the AI version (smart scheduling + real "why") replaces it when available.
import type { Attraction } from "./db";
import type { Itinerary, Stop, StopKind } from "./trip-types";
import { descriptor } from "./labels";
import { familyFit } from "./taste";

const KIND_FROM_CAT: Record<string, StopKind> = {
  nature: "nature", museum: "culture", attraction: "culture",
  sport: "nature", food: "food", shopping: "shopping",
  historic: "culture", tourism: "culture", leisure: "nature",
};
const SLOT_TIMES = ["09:30", "11:30", "14:30", "16:30", "18:00", "19:30"];

function kindOf(a: Attraction): StopKind {
  return KIND_FROM_CAT[a.category] ?? "culture";
}

export function buildHeuristicItinerary(
  city: string,
  country: string,
  days: number,
  attractions: Attraction[],
  isFamily = false,
  perDay = 5
): Itinerary {
  // Keep ones with coordinates, dedupe by name. The input is already
  // taste-ranked; only re-sort by family_score for trips with kids.
  const seen = new Set<string>();
  let pool = attractions
    .filter((a) => a.lat && a.lng)
    .filter((a) => {
      const n = a.name_he || a.name_en;
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  if (isFamily) pool = [...pool].sort((a, b) => familyFit(b) - familyFit(a));

  // perDay comes from the trip's pace (רגוע 4 / בינוני 5 / אינטנסיבי 6) so the
  // built plan matches the capacity the city page promised.
  const dayList = [];
  let idx = 0;
  for (let d = 0; d < days && idx < pool.length; d++) {
    const picks = pool.slice(idx, idx + perDay);
    idx += perDay;
    if (picks.length === 0) break;

    const stops: Stop[] = [];
    picks.forEach((a, i) => {
      // Insert a lunch slot mid-day.
      if (i === 1) {
        stops.push({
          name: "הפסקת צהריים",
          kind: "food",
          time: "12:45",
          duration: "שעה",
          note: "מסעדה מקומית באזור",
        });
      }
      stops.push({
        name: a.name_he || a.name_en,
        kind: kindOf(a),
        time: SLOT_TIMES[Math.min(i, SLOT_TIMES.length - 1)],
        duration: a.duration_minutes ? `${Math.round(a.duration_minutes / 60)} שעות` : "1.5 שעות",
        score: isFamily ? (a.family_score ?? undefined) : undefined,
        note: a.tips_he || descriptor(a),
      });
    });

    const kinds = new Set(picks.map((a) => kindOf(a)));
    const mix = kinds.has("nature") && kinds.has("culture")
      ? "שילבנו טבע ותרבות"
      : kinds.has("nature") ? "יום עם דגש על טבע" : "יום עם דגש על אטרקציות";

    dayList.push({
      label: `יום ${d + 1}`,
      date: "",
      base: city,
      why: `${mix}, עם הפסקת צהריים באמצע. סידרנו לפי מה שהכי מתאים לכם ב${city}. הוסיפו מפתח AI לתכנון חכם שמתחשב במרחקים ובפרופיל שלכם.`,
      stops,
    });
  }

  return {
    title: `טיול ב${city}`,
    subtitle: `${days} ימים · ${country}`,
    days: dayList,
  };
}

// Multi-city fallback: build each segment, concatenate with continuous day
// numbering. Used when AI is unavailable for a multi-city trip.
export function buildMultiHeuristicItinerary(
  segments: { city: string; country: string; days: number; attractions: Attraction[] }[],
  isFamily = false,
  perDay = 5
): Itinerary {
  const days: Itinerary["days"] = [];
  for (const s of segments) {
    const part = buildHeuristicItinerary(s.city, s.country, s.days, s.attractions, isFamily, perDay);
    for (const d of part.days) {
      days.push({ ...d, label: `יום ${days.length + 1}`, base: s.city });
    }
  }
  const cities = segments.map((s) => s.city).join(" → ");
  return {
    title: `טיול: ${segments.map((s) => s.city).join(" + ")}`,
    subtitle: `${days.length} ימים · ${cities}`,
    days,
  };
}
