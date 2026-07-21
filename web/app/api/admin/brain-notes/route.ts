import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { saveBrainNote, listBrainNotes } from "@/lib/db";

export const dynamic = "force-dynamic";

// Editor-only: the Brain build-policy note queue. POST queues a note from a trip
// page; GET lists notes (optionally by status) for digestion.
export async function GET(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  return NextResponse.json({ notes: await listBrainNotes(status) });
}

export async function POST(req: NextRequest) {
  const email = await editorEmail();
  if (!email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.note !== "string" || !b.note.trim()) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const id = await saveBrainNote({
    destination_id: b.destination_id ?? null, trip_ref: b.trip_ref ?? null,
    scope: b.scope ?? "city", note: b.note.trim(), created_by: email,
  });
  return NextResponse.json({ ok: true, id });
}
