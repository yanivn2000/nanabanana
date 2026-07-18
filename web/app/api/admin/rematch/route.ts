import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { rematchDestination } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // re-resolving a city's places calls the model in batches

// Editor-only: re-run the fixed matcher over a city's stored insights.
// { destination_id, apply } — apply=false previews the changes, true writes them.
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.destination_id !== "number") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    const res = await rematchDestination(b.destination_id, b.apply === true);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
