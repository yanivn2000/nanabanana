import { createClient } from "@/lib/supabase/server";

// Owner emails allowed into the admin area. Kept tiny and explicit.
const ADMINS = ["yaniv@eos-online.com"];

// Returns the signed-in admin's email, or null. Server-only.
export async function adminEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email?.toLowerCase() ?? null;
    return email && ADMINS.includes(email) ? email : null;
  } catch {
    return null;
  }
}

export async function isAdmin(): Promise<boolean> {
  return (await adminEmail()) !== null;
}
