import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { saveTripTemplate, listTripTemplates, deleteTripTemplate } from "@/lib/db";

export const dynamic = "force-dynamic";

// Team-only: the trip-module ("משבצת") library. GET lists all; POST saves a new
// module (approved by default when the editor clicks save); DELETE removes one.
export async function GET() {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ templates: await listTripTemplates(false) });
}

export async function POST(req: NextRequest) {
  const email = await editorEmail();
  if (!email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || !b.title_he || !b.itinerary || typeof b.days !== "number") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const id = await saveTripTemplate({
    destination_id: b.destination_id ?? null, region: b.region ?? null,
    title_he: b.title_he, audience: b.audience ?? null, days: b.days,
    itinerary: b.itinerary, source_urls: b.source_urls ?? [], notes: b.notes ?? null,
    approved: b.approved ?? true, created_by: email,
  });
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await deleteTripTemplate(id);
  return NextResponse.json({ ok: true });
}
