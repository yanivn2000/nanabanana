import { NextResponse, type NextRequest } from "next/server";
import { recordEvent } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Event sink. Public by necessity (it is called from the browser), so it is
// deliberately narrow: only the names we defined are stored, props are capped,
// and nothing is echoed back. An unknown name is dropped silently rather than
// erroring — a stale client should never see a failure for a metric.
const ALLOWED = new Set(["city_view", "build_started", "build_done", "search_miss", "trip_shared"]);
const MAX_PROP_LEN = 120;

export async function POST(req: NextRequest) {
  // A metrics sink is a classic flood target. Real users emit a handful of
  // events a minute; anything past this is noise we would rather drop.
  const limited = await rateLimit(req, "ev", 240, 3600).catch(() => null);
  if (limited) return NextResponse.json({ ok: true });   // drop silently, never error
  try {
    const b = await req.json().catch(() => null);
    const name = typeof b?.name === "string" ? b.name : "";
    if (!ALLOWED.has(name)) return NextResponse.json({ ok: true });

    // Keep only scalars, trimmed. No free-form objects, no unbounded strings.
    const props: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(b.props ?? {})) {
      if (Object.keys(props).length >= 8) break;
      if (typeof v === "number" || typeof v === "boolean") props[k.slice(0, 24)] = v;
      else if (typeof v === "string" && v) props[k.slice(0, 24)] = v.slice(0, MAX_PROP_LEN);
    }
    await recordEvent({
      name,
      props,
      clientId: typeof b?.clientId === "string" ? b.clientId.slice(0, 64) : null,
      path: typeof b?.path === "string" ? b.path.slice(0, 200) : null,
    });
  } catch {
    /* a metric must never surface as an error to the visitor */
  }
  return NextResponse.json({ ok: true });
}
