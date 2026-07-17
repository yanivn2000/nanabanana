// A deliberately CONSERVATIVE first-pass spam filter for public comments. It's
// not a profanity police (false positives kill a community) — it blocks the
// obvious automated-spam signals. Real moderation is the human queue (P4).

// Multiple links is the strongest bot signal in a short comment.
const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|ru|xyz|top|shop|store|click|link)\b/gi;

// A tiny explicit blocklist of unambiguous spam/scam terms (extend as needed).
const BLOCK = ["viagra", "cialis", "casino", "porn", "sex cam", "bitcoin doubl", "crypto giveaway", "t.me/joinchat"];

export function looksLikeSpam(text: string): boolean {
  const t = text.toLowerCase();
  if (BLOCK.some((w) => t.includes(w))) return true;
  const links = t.match(URL_RE)?.length ?? 0;
  if (links >= 2) return true;                       // 2+ links in one comment
  if (/(.)\1{9,}/.test(t)) return true;              // 10+ of the same char in a row
  return false;
}
