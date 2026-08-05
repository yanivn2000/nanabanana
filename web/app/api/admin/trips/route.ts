import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { adminTrips } from "@/lib/db";

export const dynamic = "force-dynamic";

// OWNER-ONLY: every user's trips. This reads across all accounts, so it is gated
// on isAdmin() (the explicit owner allow-list) and NOT on editorEmail(), which
// auto-passes in local dev and admits the whole team domain.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const trips = await adminTrips();
  const users = new Set(trips.map((t) => t.user_id)).size;
  return NextResponse.json({ trips, users });
}
