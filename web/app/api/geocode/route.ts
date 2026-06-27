import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Resolve a free-text hotel name/address to coordinates via OSM Nominatim.
// Free, no key; we set a User-Agent per the OSM usage policy.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });

  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q,
      format: "jsonv2",
      limit: "1",
      addressdetails: "1",
      "accept-language": "he",
    });

  // Hard timeout so a slow/blocked Nominatim never hangs the request.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "NanaBanana/0.1 (trip planner; yaniv@eos-online.com)" },
      signal: ctrl.signal,
    });
    if (!res.ok) return NextResponse.json({ error: "geocode failed" }, { status: 502 });
    const results = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      name?: string;
      address?: Record<string, string>;
    }>;
    if (results.length === 0) {
      return NextResponse.json({ found: false });
    }
    const r = results[0];
    const a = r.address ?? {};
    const city = a.city || a.town || a.village || a.municipality || "";
    return NextResponse.json({
      found: true,
      lat: Number(r.lat),
      lng: Number(r.lon),
      label: r.display_name,
      city,
      country: a.country || "",
    });
  } catch {
    return NextResponse.json({ error: "network" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
