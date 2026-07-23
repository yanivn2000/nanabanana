import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { POSTER_QUERY } from "@/lib/posters";
import { getDestination } from "@/lib/db";

export const dynamic = "force-dynamic";

// Admin-only: fetch real-photo candidates from Pexels for one city.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const key = process.env.PEXELS;
  if (!key) return NextResponse.json({ error: "no_pexels_key" }, { status: 500 });

  const dest = Number(new URL(req.url).searchParams.get("dest"));
  // Landmark-anchored query per city; for any city not in the hand-tuned list
  // (a newly-added destination), fall back to a query built from its own name so
  // the picker still surfaces real candidates instead of an empty "unknown_dest".
  let query = POSTER_QUERY[dest];
  if (!query) {
    const d = await getDestination(dest);
    if (!d) return NextResponse.json({ error: "unknown_dest" }, { status: 400 });
    query = `${d.city} ${d.country} skyline landmark`;
  }

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`;
  // Pexels 403s requests without a browser-like User-Agent.
  const r = await fetch(url, {
    headers: { Authorization: key, "User-Agent": "Mozilla/5.0 Yalle/0.1" },
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return NextResponse.json({ error: "pexels", status: r.status, body: body.slice(0, 200) }, { status: 502 });
  }
  const data = await r.json();

  const candidates = (data.photos ?? []).map((p: Record<string, any>) => ({
    photo_id: String(p.id),
    thumb: p.src.large,          // review thumbnail
    src_url: p.src.original,     // full-res for the finalize crop
    page_url: p.url,
    photographer: p.photographer,
    photographer_url: p.photographer_url,
    width: p.width, height: p.height,
    alt: p.alt,
  }));
  return NextResponse.json({ dest, query, candidates });
}
