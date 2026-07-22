import Link from "next/link";
import { editorEmail } from "@/lib/admin";
import { adminDestinations, listFeedback } from "@/lib/db";
import { BRAIN_VERSION } from "@/lib/brain/policy";
import { AdminView } from "./AdminView";

// The live build's git commit (Vercel injects it) + the Brain version, shown in
// admin so the editor knows exactly which version is running on the site.
const LIVE_VERSION = `${(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)} · מוח ${BRAIN_VERSION}`;

export const dynamic = "force-dynamic";

// ניהול Yalle — team-only (eos-online.com domain, same gate as editor mode).
// Tabs: ערים (destination records, editable) · פידבק (user feedback) · פוסטרים.
export default async function AdminPage() {
  const email = await editorEmail();
  if (!email) {
    return (
      <main className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="serif mb-2 text-[24px] font-bold">ניהול Yalle</h1>
        <p className="mb-4 text-[15px] text-[var(--text-2)]">
          הדף מיועד לצוות. התחברו עם חשבון eos-online.com כדי להיכנס.
        </p>
        <Link href="/login" className="inline-block rounded-full bg-[var(--brand)] px-6 py-2.5 text-[14.5px] font-medium text-white">
          התחברות
        </Link>
      </main>
    );
  }
  const [destinations, feedback] = await Promise.all([adminDestinations(), listFeedback()]);
  return <AdminView destinations={destinations} feedback={feedback} email={email} version={LIVE_VERSION} />;
}
