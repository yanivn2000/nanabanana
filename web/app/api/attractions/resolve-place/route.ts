import { NextRequest, NextResponse } from "next/server";

// Resolve a Google-Maps link (a place the traveller found — ours via "מסעדות בסביבה",
// or a friend's share) into { name, lat, lng } so it can be added to the trip.
//
// Handles both shapes:
//   • full desktop URL:  .../maps/place/<Name>/@lat,lng,17z/...!3dLAT!4dLNG...
//   • short share link:  https://maps.app.goo.gl/XXXX  (followed server-side; the
//     redirect + page HTML carry the same !3d/!4d coords and the place name)
// GET /api/attractions/resolve-place?url=<google maps url>

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function coordsFrom(text: string): { lat: number; lng: number } | null {
  // !3d<lat>!4d<lng> is the precise place pin; prefer it over the @ viewport centre.
  const precise = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (precise) return { lat: parseFloat(precise[1]), lng: parseFloat(precise[2]) };
  const at = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  // ?q=lat,lng or ?query=lat,lng (a raw-coordinate share)
  const q = text.match(/[?&](?:q|query|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
  return null;
}

function nameFrom(finalUrl: string, html: string): string | null {
  // /maps/place/<Name>/ — the cleanest source
  const m = finalUrl.match(/\/maps\/place\/([^/@]+)/);
  if (m) {
    const n = decodeURIComponent(m[1]).replace(/\+/g, " ").trim();
    if (n && !/^-?\d+\.\d+,/.test(n)) return n;
  }
  // fall back to the page <title> ("<Name> - Google Maps")
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t) {
    const n = t[1].replace(/\s*[-·|]\s*Google\s*Maps.*$/i, "").trim();
    if (n && !/^google maps$/i.test(n)) return n;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("url") ?? "").trim();
  if (!raw || !/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+)/i.test(raw)) {
    return NextResponse.json({ error: "not a google maps link" }, { status: 400 });
  }
  try {
    const res = await fetch(raw, { headers: { "user-agent": UA }, redirect: "follow" });
    const finalUrl = res.url || raw;
    const html = await res.text().catch(() => "");
    // coords: check the resolved URL first, then the page HTML (short links land the
    // precise !3d/!4d only in the body).
    const coords = coordsFrom(finalUrl) || coordsFrom(html);
    const name = nameFrom(finalUrl, html);
    if (!coords) return NextResponse.json({ error: "no coordinates in link", name });
    return NextResponse.json({ name, lat: coords.lat, lng: coords.lng });
  } catch {
    return NextResponse.json({ error: "could not open link" }, { status: 502 });
  }
}
