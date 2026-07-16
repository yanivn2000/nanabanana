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

// Editors are anyone on the eos-online.com domain (the Yalle team). They may
// curate each city's "בחירת העורך" set. In local development every request is
// treated as an editor so the mode is testable without a login; production
// (NODE_ENV=production) always enforces the real Supabase session + domain.
const EDITOR_DOMAIN = "@eos-online.com";
const DEV_EDITOR = process.env.NODE_ENV !== "production";

export async function editorEmail(): Promise<string | null> {
  if (DEV_EDITOR) return "dev-local@eos-online.com";
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email?.toLowerCase() ?? null;
    return email && email.endsWith(EDITOR_DOMAIN) ? email : null;
  } catch {
    return null;
  }
}

export async function isEditor(): Promise<boolean> {
  return (await editorEmail()) !== null;
}
