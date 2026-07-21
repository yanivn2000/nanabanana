import { NextResponse } from "next/server";
import { editorEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Client-side editor check: lets a trip page decide whether to show editor tools
// (save-as-module, note-to-Brain). Dev is always an editor; prod gates on the
// eos-online.com session (see lib/admin.ts).
export async function GET() {
  const email = await editorEmail();
  return NextResponse.json({ editor: !!email, email });
}
