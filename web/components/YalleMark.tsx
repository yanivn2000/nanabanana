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

// The coral map-pin with three spark lines above it — the "יאללה, יוצאים" energy.
// This is the exact pin from the /brand board lockup, re-expressed on tokens.
export function PinSpark({ size = 28, className, style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} style={style}>
      <g stroke="var(--accent-bright)" strokeWidth="1.8" strokeLinecap="round">
        <path d="M18.5 4.5l2.2-2.2" /><path d="M20 8h2.6" /><path d="M15.5 3v-2.4" />
      </g>
      <path d="M10 4.2c-3.5.5-6 3.3-6 6.9 0 4.4 5.2 10.2 5.9 10.9a.5.5 0 0 0 .72 0c.7-.7 5.88-6.5 5.88-10.9 0-3.6-2.5-6.4-6-6.9z"
        fill="var(--accent-bright)" />
      <circle cx="10.25" cy="10.6" r="2.5" fill="#FFF8EE" />
    </svg>
  );
}

// The primary Yalle logo lockup — the "Yalle" wordmark (Fredoka black, brand teal)
// followed by the coral pin-with-spark, exactly as on the /brand board (section 01).
// `size` is the wordmark cap height in px; the pin scales with it.
export function YalleLogo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-start" dir="ltr" aria-label="Yalle" role="img">
      <span className="serif font-black leading-none text-[var(--brand)]"
        style={{ fontSize: size, letterSpacing: "-0.02em" }}>Yalle</span>
      <PinSpark size={Math.round(size * 0.5)} className="-ms-1" style={{ marginTop: Math.round(size * 0.04) }} />
    </span>
  );
}
