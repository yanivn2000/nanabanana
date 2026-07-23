import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adoptTrips } from "@/lib/db";

export const dynamic = "force-dynamic";

// After a login, fold the trips created under the previous ANONYMOUS session into
// the now-authenticated user. `fromUserId` is the anon user id the browser held
// before signing in. Authorised by the current session (the reassign target is
// always the caller); anon ids are unguessable and held only by that browser.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no session" }, { status: 401 });
  const body = await req.json().catch(() => ({} as { fromUserId?: string }));
  const fromUserId = body.fromUserId;
  if (!fromUserId || fromUserId === user.id) return NextResponse.json({ ok: true, moved: 0 });
  const moved = await adoptTrips(fromUserId, user.id);
  return NextResponse.json({ ok: true, moved });
}
