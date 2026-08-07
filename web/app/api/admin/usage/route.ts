import { NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { usageStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  return NextResponse.json(await usageStats(days));
}
