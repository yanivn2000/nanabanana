// Yalle brand mark (direction B): a forest-green "Y" — a joyful traveler with
// raised arms — with a terracotta map-pin beside the arm (the wordmark's pin).
// Uses tokens so it adapts to dark mode.
export function YalleMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M10,10 L19,21 M28,10 L19,21 M19,21 L19,33"
        stroke="var(--brand)" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M31.5,4.5c-2.9,0-5.2,2.3-5.2,5.2 0,3.6 4.3,8.3 4.9,8.9a.42.42 0 0 0 .6,0c.6-.6 4.9-5.3 4.9-8.9 0-2.9-2.3-5.2-5.2-5.2z"
        fill="var(--accent-bright)" />
      <circle cx="31.5" cy="9.8" r="2" fill="#fff8ee" />
    </svg>
  );
}
