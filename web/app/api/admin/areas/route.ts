import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { areasForDestination, updateArea, areaAttractions } from "@/lib/db";

export const dynamic = "force-dynamic";

// Editor-only: the neighbourhood/areas layer for a city (action="list") and
// editing/approving an area (action="save").
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (b.action === "list") {
    if (typeof b.destination_id !== "number") return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const [rows, attractions] = await Promise.all([
      areasForDestination(b.destination_id), areaAttractions(b.destination_id),
    ]);
    return NextResponse.json({ rows, attractions });
  }
  if (b.action === "save") {
    if (typeof b.id !== "number" || typeof b.fields !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const ok = await updateArea(b.id, b.fields);
    return NextResponse.json({ ok });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
