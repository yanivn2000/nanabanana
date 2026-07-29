import { NextRequest, NextResponse } from "next/server";
import { searchAttractions } from "@/lib/db";

// Free-text attraction search for the trip page's "add any place" box.
// GET /api/attractions/search?dest=<destinationId>&q=<query>
export async function GET(req: NextRequest) {
  const dest = Number(req.nextUrl.searchParams.get("dest"));
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!dest || q.length < 2) return NextResponse.json({ results: [] });
  const rows = await searchAttractions(dest, q, 20);
  const results = rows.map((a) => ({
    id: a.id, name_he: a.name_he, name_en: a.name_en, category: a.category,
    lat: a.lat, lng: a.lng, image_url: a.image_url, tagline_he: a.tagline_he,
    tips_he: a.tips_he, description_he: a.description_he, must_see: a.must_see,
  }));
  return NextResponse.json({ results });
}
