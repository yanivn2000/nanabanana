import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { listContentGaps, updateAttractionContent } from "@/lib/db";
import { contentCandidates } from "@/lib/wiki";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // candidate lookups fan out to Wikidata + Wikipedia

// GET  ?destinationId=  → the must-see content-gap list (no image / thin description)
export async function GET(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const destRaw = new URL(req.url).searchParams.get("destinationId");
  const destinationId = destRaw ? Number(destRaw) : undefined;
  const gaps = await listContentGaps({ destinationId });
  return NextResponse.json({ gaps });
}

// POST { action: "candidates", name_en, name_he, lat, lng }  → image/description options
//      { action: "save", id, image_url?, description_he?, tagline_he? }
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);

  if (b?.action === "candidates") {
    if (typeof b.lat !== "number" || typeof b.lng !== "number") return NextResponse.json({ error: "bad_coords" }, { status: 400 });
    const c = await contentCandidates(b.name_he ?? null, String(b.name_en ?? ""), b.lat, b.lng);
    return NextResponse.json(c);
  }

  if (b?.action === "save") {
    const id = typeof b.id === "number" ? b.id : null;
    if (id == null) return NextResponse.json({ error: "bad_id" }, { status: 400 });
    const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : undefined);
    await updateAttractionContent(id, {
      image_url: b.image_url === null ? null : clip(b.image_url, 1000),
      description_he: b.description_he === null ? null : clip(b.description_he, 4000),
      tagline_he: b.tagline_he === null ? null : clip(b.tagline_he, 300),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
