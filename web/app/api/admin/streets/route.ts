import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { streetsForCity, updateStreet, areasForDestination } from "@/lib/db";

export const dynamic = "force-dynamic";

// Editor-only: the recommended-streets layer for a city (action="list", also
// returns the city's areas for the neighbourhood dropdown) and editing/approving
// a street (action="save").
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (b.action === "list") {
    if (typeof b.destination_id !== "number") return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const [rows, areas] = await Promise.all([
      streetsForCity(b.destination_id), areasForDestination(b.destination_id),
    ]);
    return NextResponse.json({ rows, areas: areas.map((a) => ({ id: a.id, name_he: a.name_he })) });
  }
  if (b.action === "save") {
    if (typeof b.id !== "number" || typeof b.fields !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const ok = await updateStreet(b.id, b.fields);
    return NextResponse.json({ ok });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
