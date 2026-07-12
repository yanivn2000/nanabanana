"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Shows "sign in" when logged out, or the user's email + sign-out when logged in.
// `showEmail` forces the email to render on mobile too (nav hides it under lg).
export function AuthButton({ showEmail = false }: { showEmail?: boolean }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setEmail(session?.user?.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (email === undefined) return null; // not resolved yet

  if (!email) {
    return (
      <Link href="/login"
        className="flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-[14px] font-medium text-white">
        <LogIn size={16} /> התחברות
      </Link>
    );
  }

  return (
    <button
      onClick={async () => { await createClient().auth.signOut(); location.href = "/"; }}
      className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] text-[var(--text-2)]"
      title="התנתקות">
      <span className={`max-w-[160px] truncate ${showEmail ? "" : "hidden lg:inline"}`}>{email}</span>
      <LogOut size={16} />
    </button>
  );
}
