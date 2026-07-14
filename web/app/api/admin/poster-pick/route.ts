import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getPosterPicks, setPosterPick } from "@/lib/db";

export const dynamic = "force-dynamic";

// Admin-only: current picks (for the picker's selected state).
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ picks: await getPosterPicks() });
}

// Admin-only: save the chosen photo for a city.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.dest_id !== "number" || !b.photo_id || !b.src_url) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  await setPosterPick({
    dest_id: b.dest_id, variant: b.variant ?? "default", source: "pexels",
    photo_id: String(b.photo_id), photographer: b.photographer ?? "",
    photographer_url: b.photographer_url ?? "", src_url: b.src_url,
    page_url: b.page_url ?? "", width: Number(b.width) || 0, height: Number(b.height) || 0,
  });
  return NextResponse.json({ ok: true });
}
