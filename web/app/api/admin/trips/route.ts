import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { adminTrips, adminTripUsers, adminTripDetail } from "@/lib/db";

export const dynamic = "force-dynamic";

// OWNER-ONLY: every user's trips. This reads across all accounts, so it is gated
// on isAdmin() (the explicit owner allow-list) and NOT on editorEmail(), which
// auto-passes in local dev and admits the whole team domain.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // ?user=<uuid>&trip=<client_id> → that one trip's full stored object, so the
  // admin can read the actual itinerary a traveller got (read-only).
  const user = req.nextUrl.searchParams.get("user");
  const trip = req.nextUrl.searchParams.get("trip");
  if (user && trip) return NextResponse.json({ trip: await adminTripDetail(user, trip) });
  const [trips, users] = await Promise.all([adminTrips(), adminTripUsers()]);
  return NextResponse.json({ trips, users });
}
