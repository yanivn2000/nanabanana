"use client";

// Category tiles (board "קומפוננטות UI · קטגוריות"): rounded-square tile with a
// filled two-tone icon (forest green + warm gold) and the label below. The icon
// set is a brand asset — simple filled geometry, not line icons.

const G = "var(--brand)";        // forest green
const A = "var(--amber-fill)";   // warm gold

// 32×32 filled two-tone icons, keyed by the interest vocabulary (store.ts).
export const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "טבע": (
    <g>
      <path d="M3 26 L12.5 9 L18.5 19.5 L22 13.5 L29 26 Z" fill={G} />
      <circle cx="25" cy="8" r="3.2" fill={A} />
    </g>
  ),
  "אוכל": (
    <g fill={A}>
      <path d="M10 3 v8 a3 3 0 0 0 2 2.8 V29 h3 V13.8 A3 3 0 0 0 17 11 V3 h-2.2 v7 h-1.3 V3 h-1.2 v7 H11 V3 Z" />
      <path d="M22.5 3 c-2.5 0-4 2.6-4 6 0 2.7 1 4.7 2.6 5.6 V29 h2.8 V14.6 c1.6-.9 2.6-2.9 2.6-5.6 0-3.4-1.5-6-4-6 Z" />
    </g>
  ),
  "תרבות": (
    <g fill={A}>
      <path d="M16 3 L29 10 H3 Z" />
      <rect x="5" y="12" width="3.4" height="11" rx="1" />
      <rect x="11" y="12" width="3.4" height="11" rx="1" />
      <rect x="17.6" y="12" width="3.4" height="11" rx="1" />
      <rect x="23.6" y="12" width="3.4" height="11" rx="1" />
      <rect x="3" y="24.5" width="26" height="4" rx="1.5" />
    </g>
  ),
  "קניות": (
    <g>
      <path d="M7 11 h18 l-1.6 16 a3 3 0 0 1 -3 2.7 H11.6 a3 3 0 0 1 -3-2.7 Z" fill={G} />
      <path d="M12 14 v-4.5 a4 4 0 0 1 8 0 V14" stroke={A} strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  ),
  "ספורט": (
    <g fill={A}>
      <path d="M10 4 h12 v7 a6 6 0 0 1 -12 0 Z" />
      <path d="M10 6 H5.5 a4.5 4.5 0 0 0 4.7 5.6 M22 6 h4.5 a4.5 4.5 0 0 1 -4.7 5.6" stroke={A} strokeWidth="2" fill="none" />
      <rect x="14" y="16.5" width="4" height="5" />
      <rect x="10" y="22" width="12" height="3.6" rx="1.4" />
      <rect x="8" y="26" width="16" height="3" rx="1.4" />
    </g>
  ),
  "חופים": (
    <g>
      <path d="M4 24 c0-9 6.5-15 14-15 6 0 10 3.8 10 8.2 0 3.9-3 6.4-6.4 6.4 -2.8 0-4.8-1.7-4.8-4 0-1.9 1.4-3.2 3.1-3.2 -1-1.5-3-2.4-5.2-1.7 -3.6 1.1-5.4 4.9-4.3 9.3 Z" fill={G} />
      <path d="M3 27.5 h26" stroke={A} strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  "פארקי שעשועים": (
    <g>
      <circle cx="16" cy="14" r="9.5" stroke={G} strokeWidth="2.4" fill="none" />
      <path d="M16 4.5 v19 M6.5 14 h19 M9.3 7.3 l13.4 13.4 M22.7 7.3 L9.3 20.7" stroke={G} strokeWidth="1.8" />
      <circle cx="16" cy="4.5" r="2.6" fill={A} /><circle cx="16" cy="23.5" r="2.6" fill={A} />
      <circle cx="6.5" cy="14" r="2.6" fill={A} /><circle cx="25.5" cy="14" r="2.6" fill={A} />
      <path d="M12 29 l4-6 4 6 Z" fill={G} />
    </g>
  ),
  "היסטוריה": (
    <g>
      <path d="M8 29 V9 h-2 V4 h3.4 v2.4 h3 V4 h7.2 v2.4 h3 V4 H26 v5 h-2 v20 Z" fill={G} />
      <path d="M16 29 v-7 a2.6 2.6 0 0 1 5.2 0 v7 Z" fill="#fff8ee" opacity="0.9" />
      <path d="M16 4 V0.8 l6-.0 -2 2 2 2 -6 0 Z" fill={A} transform="translate(0 1)" />
    </g>
  ),
  "מוזיקה חיה": (
    <g fill={G}>
      <path d="M12.5 6 L26 3.4 v4.2 L15.5 9.8 V23 a4.6 4.6 0 1 1 -3-4.3 Z" />
      <circle cx="23" cy="21.5" r="4" />
      <rect x="25.7" y="7" width="2.4" height="14" rx="1" />
    </g>
  ),
  "חיי לילה": (
    <g>
      <path d="M5 6 h22 L16 18 Z" fill={A} />
      <rect x="14.8" y="17" width="2.4" height="9" fill={A} />
      <rect x="9" y="27" width="14" height="2.6" rx="1.3" fill={A} />
      <circle cx="12" cy="9" r="2.4" fill={G} />
    </g>
  ),
  "מחזמר ותיאטרון": (
    <g>
      <path d="M4 6 a8.5 8.5 0 0 0 17 0 Z" fill={G} transform="translate(1 4)" />
      <path d="M11 6 a8.5 8.5 0 0 0 17 0 Z" fill={A} transform="translate(-1 12)" />
    </g>
  ),
  "בלט ואופרה": (
    <g fill={A}>
      <path d="M4 4 h24 v3 H4 Z" />
      <path d="M6 7 c0 10 2.5 14 5.5 20 L8 27 C5.5 20 5 14 5 7 Z M26 7 c0 10 -2.5 14 -5.5 20 L24 27 c2.5-7 3-13 3-20 Z" />
      <path d="M9 7 c0 8 2 13 7 18 5-5 7-10 7-18 Z" fill={G} />
    </g>
  ),
  "וינטג'": (
    <g fill={G}>
      <path d="M11 4 a5 5 0 0 0 10 0 l7 3.5 -2.4 5.2 -3.6-1.5 V29 H9 V11.2 l-3.6 1.5 L3 7.5 Z" />
      <circle cx="16" cy="14" r="2.2" fill={A} />
    </g>
  ),
  "יוקרה": (
    <g fill={A}>
      <path d="M8 4 h16 l5 7 -13 17 L3 11 Z" />
      <path d="M8 4 l4 7 4-7 4 7 4-7" stroke="#fff8ee" strokeWidth="1.4" fill="none" />
      <path d="M3 11 h26" stroke="#fff8ee" strokeWidth="1.4" />
    </g>
  ),
  "לילדים": (
    <g>
      <circle cx="10" cy="9" r="4.2" fill={G} />
      <path d="M3.5 27 c0-5 2.6-8.5 6.5-8.5 s6.5 3.5 6.5 8.5 Z" fill={G} />
      <circle cx="22.5" cy="11" r="3.4" fill={A} />
      <path d="M17.5 27 c0-4.2 2.1-7 5-7 s5 2.8 5 7 Z" fill={A} />
    </g>
  ),
  "מוזיאונים": (
    <g>
      <rect x="4" y="6" width="24" height="20" rx="2.5" fill={G} />
      <rect x="7.5" y="9.5" width="17" height="13" rx="1.2" fill="#fff8ee" />
      <path d="M9 21 l4.5-6 3.5 4 2.5-3 4 5 Z" fill={A} />
      <circle cx="12" cy="13" r="1.6" fill={A} />
    </g>
  ),
};

// A category tile. `selected` = binary (interested / not) for simple pickers;
// `state` = tri-state (yes / no / none) for the profile's single preference list.
export type TileState = "yes" | "no" | "none";

export function CategoryTile({ label, selected, state, onClick }: {
  label: string; selected?: boolean; state?: TileState; onClick?: () => void;
}) {
  const icon = CATEGORY_ICONS[label];
  const s: TileState = state ?? (selected ? "yes" : "none");
  const box =
    s === "yes" ? { background: "var(--brand-soft)", border: "1.5px solid var(--brand)" }
    : s === "no" ? { background: "var(--surface-2)", border: "1.5px solid var(--border)" }
    : { background: "var(--surface)", border: "1.5px solid var(--border)" };
  return (
    <button type="button" onClick={onClick} aria-pressed={s === "yes"}
      className="relative flex flex-col items-center justify-center gap-1.5 rounded-[18px] px-1 py-3 transition"
      style={box}>
      {s !== "none" && (
        <span className="absolute end-1.5 top-1.5 grid size-[18px] place-items-center rounded-full text-[11px] font-bold leading-none text-white"
          style={{ background: s === "yes" ? "var(--brand)" : "var(--text-3)" }}>
          {s === "yes" ? "✓" : "✕"}
        </span>
      )}
      <span style={{ opacity: s === "no" ? 0.5 : 1 }}>
        {icon ? (
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>{icon}</svg>
        ) : (
          <span className="grid size-[30px] place-items-center text-[20px]">✦</span>
        )}
      </span>
      <span className="text-[13px] font-medium leading-tight"
        style={{
          color: s === "yes" ? "var(--brand-ink)" : "var(--text-2)",
          textDecoration: s === "no" ? "line-through" : "none",
          opacity: s === "no" ? 0.6 : 1,
        }}>{label}</span>
    </button>
  );
}
