// UI audiences the traveller picks. The biggest real split is with-kids vs without,
// so couples + friends are ONE choice ("זוגות וחברים"); families stay separate. The
// data layer still stores all three per-audience fits — "adults" reads whichever of
// couples/friends fits BEST for each place, so merging the button keeps the signal.
export type Profile = "families" | "adults";
export const PROFILES: Profile[] = ["families", "adults"];
export const PROFILE_HE: Record<Profile, string> = { families: "משפחות", adults: "זוגות וחברים" };
export const PROFILE_EMOJI: Record<Profile, string> = { families: "👨‍👩‍👧", adults: "💑" };
