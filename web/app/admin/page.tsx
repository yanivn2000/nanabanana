import Link from "next/link";
import { editorEmail } from "@/lib/admin";
import { adminDestinations, listFeedback } from "@/lib/db";
import { AdminView } from "./AdminView";

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
  return <AdminView destinations={destinations} feedback={feedback} email={email} />;
}
