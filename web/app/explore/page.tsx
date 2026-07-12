import { redirect } from "next/navigation";

// The "גלו יעדים" list now lives on the home page (the "גלה" nav item was
// removed). Redirect any old /explore links there. (/explore/[id] — the
// per-destination exploration flow — is a separate route and unaffected.)
export default function ExploreIndex() {
  redirect("/");
}
