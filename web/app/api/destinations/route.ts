import { NextResponse } from "next/server";
import { listDestinations } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ destinations: await listDestinations() });
}
