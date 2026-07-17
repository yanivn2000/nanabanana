import { NextRequest, NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";
import { saveInsights, type IngestItem } from "@/lib/db";
import { distillPost } from "@/lib/insights-ingest";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // distilling a long thread takes a while

const KINDS = new Set(["tip", "warning", "verdict", "food", "season", "access"]);

// Team-only: the insights-ingest flow (טאב "תובנות" באדמין).
// action="distill": run Claude over a pasted/dropped post → structured items.
// action="save": persist the reviewed items (matched to attractions).
export async function POST(req: NextRequest) {
  if (!(await editorEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.destination_id !== "number") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (b.action === "distill") {
    // distill calls Claude — throttle even though it's editor-gated (a stuck
    // loop or compromised session shouldn't run up the bill).
    const limited = await rateLimit(req, "insights-distill", 20, 3600);
    if (limited) return limited;
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (text.length < 30) return NextResponse.json({ error: "text_too_short" }, { status: 400 });
    const destName = typeof b.dest_name === "string" ? b.dest_name : String(b.destination_id);
    try {
      const items = await distillPost(text, destName, b.thread === true);
      return NextResponse.json({ items });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (b.action === "save") {
    const items = (Array.isArray(b.items) ? b.items : []).filter(
      (it: IngestItem) => it && typeof it.text_he === "string" && it.text_he.length > 0 && KINDS.has(it.kind)
    );
    if (!items.length) return NextResponse.json({ error: "no_items" }, { status: 400 });
    const result = await saveInsights(
      b.destination_id,
      typeof b.url === "string" && b.url ? b.url : null,
      typeof b.author === "string" && b.author ? b.author : null,
      typeof b.raw_text === "string" ? b.raw_text : "",
      items
    );
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
