import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UA = "NanaBanana/0.1 (trip planner; yaniv@eos-online.com)";

type GeoHit = {
  lat: number; lng: number; label: string; city: string; country: string;
};

async function withTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Provider 1: OSM Nominatim (rich Hebrew labels, but strict rate limits).
async function viaNominatim(q: string): Promise<GeoHit | null> {
  const url = "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q, format: "jsonv2", limit: "1",
      addressdetails: "1", "accept-language": "he" });
  const res = await withTimeout(url, 7000);
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const r = (await res.json())?.[0];
  if (!r) return null;
  const a = r.address ?? {};
  return {
    lat: Number(r.lat), lng: Number(r.lon), label: r.display_name,
    city: a.city || a.town || a.village || a.municipality || "",
    country: a.country || "",
  };
}

// Provider 2: Photon (Komoot) — also OSM-based, far more lenient. Fallback.
async function viaPhoton(q: string): Promise<GeoHit | null> {
  const url = "https://photon.komoot.io/api/?" +
    new URLSearchParams({ q, limit: "1", lang: "default" });
  const res = await withTimeout(url, 7000);
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const f = (await res.json())?.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  const p = f.properties ?? {};
  const label = [p.name, p.street, p.city, p.country].filter(Boolean).join(", ");
  return { lat, lng, label: label || p.name || q, city: p.city || "", country: p.country || "" };
}

// Resolve with the first provider that returns a hit; null only if all finish
// without one. Running them in parallel keeps latency to the fastest provider.
function firstHit(promises: Promise<GeoHit | null>[]): Promise<GeoHit | null> {
  return new Promise((resolve) => {
    let remaining = promises.length;
    let done = false;
    for (const p of promises) {
      p.then((hit) => { if (hit && !done) { done = true; resolve(hit); } })
        .catch(() => {})
        .finally(() => { remaining -= 1; if (remaining === 0 && !done) resolve(null); });
    }
  });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });

  const hit = await firstHit([
    viaNominatim(q).catch((e) => { console.warn(`[geocode] nominatim: ${e.message}`); return null; }),
    viaPhoton(q).catch((e) => { console.warn(`[geocode] photon: ${e.message}`); return null; }),
  ]);
  console.log(`[geocode] "${q}" -> ${hit ? "found" : "not found"}`);
  return NextResponse.json(hit ? { found: true, ...hit } : { found: false });
}
