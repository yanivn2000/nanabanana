import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { adminGraph } from "@/lib/db";

export const dynamic = "force-dynamic";

// Editor-only: distance-graph coverage stats + top-N attractions (with coords) for
// the walk/transit matrix, computed client-side.
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.destination_id !== "number") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  return NextResponse.json(await adminGraph(b.destination_id, 40));
}
