// Yalle illustrations — flat-warm vector scenes in brand tokens (adapt to dark
// mode automatically). Used for empty states / onboarding / loading, per the
// brand rule: illustration for moments, real photos for content.

// A packed suitcase with travel stickers, a standing pin, and a dashed flight
// path — "the suitcase is ready, where to?".
export function SuitcaseArt({ width = 210 }: { width?: number }) {
  return (
    <svg width={width} viewBox="0 0 230 150" fill="none" aria-hidden>
      {/* ground */}
      <ellipse cx="112" cy="132" rx="80" ry="12" fill="var(--brand-soft)" />
      {/* dashed flight path + paper plane */}
      <path d="M22 100 C 46 42, 108 24, 168 34" stroke="var(--accent-bright)" strokeWidth="2.4"
        strokeDasharray="1.5 8" strokeLinecap="round" />
      <path d="M168 34 l22 -8 -12 19 -5.5 -6.5 z" fill="var(--accent-bright)" />
      {/* suitcase */}
      <rect x="62" y="62" width="86" height="66" rx="12" fill="var(--accent-bright)" />
      <rect x="62" y="62" width="86" height="66" rx="12" fill="rgba(16,29,43,0.06)" />
      <rect x="66" y="66" width="78" height="58" rx="9" fill="var(--accent-bright)" />
      {/* handle */}
      <path d="M90 62 v-9 a8 8 0 0 1 8-8 h14 a8 8 0 0 1 8 8 v9" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" fill="none" />
      {/* straps */}
      <rect x="82" y="66" width="7" height="58" rx="3.5" fill="var(--brand)" opacity="0.85" />
      <rect x="121" y="66" width="7" height="58" rx="3.5" fill="var(--brand)" opacity="0.85" />
      {/* stickers */}
      <circle cx="106" cy="84" r="8" fill="#fff8ee" />
      <circle cx="106" cy="84" r="8" stroke="var(--brand)" strokeWidth="1.6" strokeDasharray="2 3" />
      <rect x="98" y="100" width="18" height="12" rx="3" fill="var(--amber-soft)" transform="rotate(-8 107 106)" />
      {/* standing pin */}
      <path d="M178 74c-8.8 0-16 7.2-16 16 0 11 13.2 25.4 15.1 27.4a1.3 1.3 0 0 0 1.8 0c1.9-2 15.1-16.4 15.1-27.4 0-8.8-7.2-16-16-16z" fill="var(--brand)" />
      <circle cx="178" cy="90.5" r="6.2" fill="#fff8ee" />
    </svg>
  );
}
