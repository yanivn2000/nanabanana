import { NextRequest, NextResponse } from "next/server";
import { getPosterPick } from "@/lib/db";

export const dynamic = "force-dynamic";

// Live city poster: redirects to the photo picked in the admin poster picker
// (poster_picks), sized per orientation via the Pexels CDN. This makes an admin
// pick published INSTANTLY — no static-file materialization step. CityPoster
// falls back to the static art / brand gradient when there's no pick (404).
const DIMS: Record<string, string> = {
  banner: "w=1600&h=800&fit=crop",
  landscape: "w=1600&h=1000&fit=crop",
  portrait: "w=900&h=1200&fit=crop",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ destId: string }> }
) {
  const id = Number((await params).destId);
  if (!Number.isFinite(id)) return new NextResponse(null, { status: 400 });
  const pick = await getPosterPick(id);
  if (!pick?.src_url) return new NextResponse(null, { status: 404 });
  const o = req.nextUrl.searchParams.get("o") ?? "landscape";
  const url = `${pick.src_url}?auto=compress&cs=tinysrgb&${DIMS[o] ?? DIMS.landscape}`;
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: url,
      // cache the redirect at the edge; a new pick shows within the hour
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
