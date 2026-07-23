"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

// Ensure there is ALWAYS a session so trips can be stored server-side: reuse the
// existing session if any, otherwise sign in ANONYMOUSLY (a real auth user with
// is_anonymous=true). Degrades gracefully — if anonymous sign-ins are disabled or
// Supabase is unreachable, returns null and the app keeps working off localStorage.
export async function ensureSession(): Promise<User | null> {
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) return session.user;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) return null;
    return data.user ?? null;
  } catch {
    return null;
  }
}

// Client hook: the current user (ensuring an anonymous session on first load), and
// live updates on auth changes (anon → permanent login, sign-out, etc.).
export function useSessionUser(): { user: User | null; loaded: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    const supabase = createClient();
    ensureSession().then((u) => { if (mounted) { setUser(u); setLoaded(true); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setUser(session?.user ?? null);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);
  return { user, loaded };
}
