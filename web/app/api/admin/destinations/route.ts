import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { adminDestinations, updateDestination } from "@/lib/db";

export const dynamic = "force-dynamic";

// Team-only (eos-online.com domain): the admin cities data.
export async function GET() {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ destinations: await adminDestinations() });
}

// Team-only: update a destination's editable fields.
export async function PATCH(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.id !== "number" || typeof b.fields !== "object" || !b.fields) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const ok = await updateDestination(b.id, b.fields);
  return ok ? NextResponse.json({ ok: true })
            : NextResponse.json({ error: "no_editable_fields" }, { status: 400 });
}
