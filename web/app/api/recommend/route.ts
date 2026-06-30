import { NextRequest, NextResponse } from "next/server";
import { destinationSummaries, type DestinationSummary } from "@/lib/db";
import { aiConfigured, recommendDestinations, type DestinationReco } from "@/lib/ai";

export const dynamic = "force-dynamic";

const CAT_HE: Record<string, string> = {
  museum: "מוזיאונים", historic: "אתרים היסטוריים", nature: "טבע",
  food: "אוכל", shopping: "קניות", water_park: "פארקי מים",
  theme_park: "פארקי שעשועים", zoo: "גני חיות",
};

// Top categories of a destination, as Hebrew highlight keywords.
function highlightsOf(s: DestinationSummary): string {
  const cats: [string, number][] = [
    ["museum", s.museum], ["historic", s.historic], ["nature", s.nature],
    ["water_park", s.water_park], ["theme_park", s.theme_park], ["zoo", s.zoo],
    ["food", s.food], ["shopping", s.shopping],
  ];
  return cats.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([c]) => CAT_HE[c]).join(", ");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const profileText: string = body.profileText || "משפחה · קצב רגוע";
  const month: number | undefined = body.month;

  const summaries = await destinationSummaries();
  if (summaries.length === 0) {
    return NextResponse.json({ error: "no destinations" }, { status: 404 });
  }

  let recos: DestinationReco[];
  if (aiConfigured()) {
    try {
      recos = await recommendDestinations({ profileText, month, summaries });
    } catch (e) {
      console.warn(`[recommend] AI failed, heuristic: ${(e as Error).message}`);
      recos = heuristic(summaries);
    }
  } else {
    recos = heuristic(summaries);
  }

  // Map each recommended city back to our destination for linking/display.
  const byCity = new Map(summaries.map((s) => [s.city.toLowerCase(), s]));
  const recommendations = recos
    .map((r) => {
      const s = byCity.get((r.city || "").toLowerCase());
      if (!s) return null;
      return {
        id: s.id, city_he: s.city_he, city: s.city,
        country_he: s.country_he, country: s.country, total: s.total,
        reason: r.reason, highlights: r.highlights || highlightsOf(s),
      };
    })
    .filter(Boolean)
    .slice(0, 4);

  return NextResponse.json({ recommendations });
}

// No-AI fallback: top destinations by must-see richness, generic reasoning.
function heuristic(summaries: DestinationSummary[]): DestinationReco[] {
  return [...summaries]
    .sort((a, b) => b.must_see * 3 + b.total - (a.must_see * 3 + a.total))
    .slice(0, 3)
    .map((s) => ({
      city: s.city,
      reason: "יעד עשיר באטרקציות למשפחות — בחירה בטוחה למגוון תחומי עניין.",
      highlights: highlightsOf(s),
    }));
}
