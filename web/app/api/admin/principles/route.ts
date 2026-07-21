import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { listPrinciples, savePrinciple, updatePrinciple, deletePrinciple } from "@/lib/db";

export const dynamic = "force-dynamic";

// Editor-only: the Brain's TECHNIQUE rules ("how to cook"). GET lists; POST adds a
// typed rule; PATCH edits params/enabled/scope; DELETE removes.
export async function GET() {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ principles: await listPrinciples() });
}

export async function POST(req: NextRequest) {
  const email = await editorEmail();
  if (!email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.kind !== "string") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const id = await savePrinciple({
    kind: b.kind, params: b.params ?? {}, scope: b.scope ?? "global",
    destination_id: b.destination_id ?? null, audience: b.audience ?? null, created_by: email,
  });
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.id !== "number") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await updatePrinciple(b.id, {
    params: b.params, enabled: b.enabled, audience: b.audience, scope: b.scope, destination_id: b.destination_id,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await deletePrinciple(id);
  return NextResponse.json({ ok: true });
}
