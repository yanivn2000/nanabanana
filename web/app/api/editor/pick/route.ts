import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { setEditorPick } from "@/lib/db";

export const dynamic = "force-dynamic";

// Editor-only: add/remove an attraction from a city's "בחירת העורך" set.
// Authorized to anyone on the eos-online.com domain (see lib/admin.ts).
export async function POST(req: NextRequest) {
  const email = await editorEmail();
  if (!email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.destination_id !== "number" || typeof b.attraction_id !== "number" || typeof b.pick !== "boolean") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  await setEditorPick(b.destination_id, b.attraction_id, b.pick, email);
  return NextResponse.json({ ok: true });
}
