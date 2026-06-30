import { NextRequest, NextResponse } from "next/server";
import { haversineKm } from "@/lib/geo";

export const dynamic = "force-dynamic";

const UA = "Yalle/0.1 (trip planner; yaniv@eos-online.com)";

type GeoHit = { lat: number; lng: number; label: string; city: string; country: string };

// English country name -> ISO code, to bias Nominatim to the right country.
const CC: Record<string, string> = {
  Austria: "at", Germany: "de", Hungary: "hu", Czechia: "cz", "Czech Republic": "cz",
  Spain: "es", Italy: "it", Greece: "gr", Netherlands: "nl", France: "fr",
  Portugal: "pt", Georgia: "ge", Switzerland: "ch", "United Kingdom": "gb",
  Cyprus: "cy", Israel: "il", Romania: "ro", Poland: "pl",
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

type NomResult = {
  lat: string; lon: string; display_name: string; name?: string;
  importance?: number; address?: Record<string, string>;
};

// Pick the candidate that best MATCHES the query — not just the first hit.
// Heavily rewards exact/prefix name matches and query-token coverage, so
// "Flachau" beats "Flachauwinkl" and "…Bergheimat, Flachau" stays in Flachau.
function pickBest(q: string, cands: NomResult[], near?: [number, number]): NomResult | null {
  if (cands.length === 0) return null;
  const ql = q.toLowerCase().trim();
  const tokens = ql.split(/[\s,]+/).filter((t) => t.length >= 3);

  const scored = cands.map((c) => {
    const name = (c.name || c.display_name.split(",")[0] || "").toLowerCase().trim();
    const dn = c.display_name.toLowerCase();
    let s = Number(c.importance || 0);
    if (name === ql) s += 3;
    else if (name.startsWith(ql) || ql.startsWith(name)) s += 1.5;
    s += tokens.filter((t) => dn.includes(t)).length * 0.8;   // query-token coverage
    if (near) {
      const km = haversineKm(near[0], near[1], Number(c.lat), Number(c.lon));
      s += Math.max(0, 1 - km / 200);                          // soft proximity bonus (~200km)
    }
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0].c;
}

async function nominatim(q: string, cc?: string): Promise<NomResult[]> {
  const params = new URLSearchParams({
    q, format: "jsonv2", limit: "10", addressdetails: "1", "accept-language": "he",
  });
  if (cc) params.set("countrycodes", cc);
  const res = await withTimeout(`https://nominatim.openstreetmap.org/search?${params}`, 7000);
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return (await res.json()) as NomResult[];
}

async function photon(q: string): Promise<GeoHit | null> {
  const res = await withTimeout(
    `https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: "1", lang: "default" })}`, 7000);
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const f = (await res.json())?.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  const p = f.properties ?? {};
  const label = [p.name, p.street, p.city, p.country].filter(Boolean).join(", ");
  return { lat, lng, label: label || p.name || q, city: p.city || "", country: p.country || "" };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });

  const ccParam = sp.get("cc")?.trim();              // English country name or ISO
  const cc = ccParam ? (CC[ccParam] || (ccParam.length === 2 ? ccParam.toLowerCase() : "")) : "";
  const lat = Number(sp.get("lat")), lng = Number(sp.get("lng"));
  const near: [number, number] | undefined =
    Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : undefined;

  let hit: GeoHit | null = null;
  try {
    // Try with the country bias first, then without (so a slightly-off country still resolves).
    let cands = await nominatim(q, cc || undefined);
    if (cands.length === 0 && cc) cands = await nominatim(q);
    const best = pickBest(q, cands, near);
    if (best) {
      const a = best.address ?? {};
      hit = {
        lat: Number(best.lat), lng: Number(best.lon), label: best.display_name,
        city: a.city || a.town || a.village || a.municipality || a.county || "",
        country: a.country || "",
      };
    }
  } catch (e) {
    console.warn(`[geocode] nominatim: ${(e as Error).message}`);
  }
  if (!hit) {
    hit = await photon(q).catch((e) => { console.warn(`[geocode] photon: ${e.message}`); return null; });
  }
  console.log(`[geocode] "${q}"${cc ? ` cc=${cc}` : ""} -> ${hit ? "found" : "not found"}`);
  return NextResponse.json(hit ? { found: true, ...hit } : { found: false });
}
