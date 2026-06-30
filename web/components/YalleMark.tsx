// Yalle brand mark: a coral "Y" (a joyful traveler with raised arms) topped by
// a teal map-pin head. No smile — stays crisp at small sizes.
export function YalleMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M11,14 L20,22 L29,14 M20,22 L20,32"
        stroke="#f4685e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20,20 C16.6,13.8 15.6,12.3 15.6,9.8 a4.4,4.4 0 1,1 8.8,0 c0,2.5 -1,4 -4.4,10.2 z"
        fill="#1fa8a0" />
      <circle cx="20" cy="9.4" r="1.7" fill="#ffffff" />
    </svg>
  );
}
