import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { setEditorRating } from "@/lib/db";

export const dynamic = "force-dynamic";

const RANK = new Set(["must", "maybe", "no"]);
const KIDS = new Set(["yes", "maybe", "no"]);

// Editor-only: set an attraction's importance rank or kids fit (null clears).
// Authorized to anyone on the eos-online.com domain (see lib/admin.ts).
export async function POST(req: NextRequest) {
  const email = await editorEmail();
  if (!email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.destination_id !== "number" || typeof b.attraction_id !== "number"
    || (b.field !== "rank" && b.field !== "kids")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const allowed = b.field === "rank" ? RANK : KIDS;
  const value = b.value == null ? null : String(b.value);
  if (value !== null && !allowed.has(value)) {
    return NextResponse.json({ error: "bad_value" }, { status: 400 });
  }
  await setEditorRating(b.destination_id, b.attraction_id, b.field, value, email);
  return NextResponse.json({ ok: true });
}
