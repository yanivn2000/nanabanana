import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { adminAttractionsForCity, setAdminBonus } from "@/lib/db";

export const dynamic = "force-dynamic";

// Editor-only: the full attraction table for a city (action="list") and the
// per-audience manual bonus (action="bonus").
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (b.action === "list") {
    if (typeof b.destination_id !== "number") return NextResponse.json({ error: "bad_request" }, { status: 400 });
    return NextResponse.json({ rows: await adminAttractionsForCity(b.destination_id) });
  }
  if (b.action === "bonus") {
    if (typeof b.attraction_id !== "number") return NextResponse.json({ error: "bad_request" }, { status: 400 });
    await setAdminBonus(b.attraction_id, {
      families: b.families, couples: b.couples, friends: b.friends,
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
