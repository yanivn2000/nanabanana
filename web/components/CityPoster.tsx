"use client";

import { useState } from "react";
import { posterSrcs } from "@/lib/posters";

// The house "photographic language" — one consistent grade over every city photo
// so a set of diverse real photos reads as one family: gently muted, soft
// contrast, a touch of warmth. Non-destructive (display filter only); tune here.
const GRADE = "saturate(0.9) contrast(1.06) brightness(1.03) sepia(0.1)";

// City poster with a graceful brand-gradient fallback.
// Two modes:
//  • default — a solid poster that fills its box (object-cover), optional dark
//    scrim (`overlay`) for white text overlaid via `children`.
//  • `ambient` — the poster as a faint, tinted BACKGROUND that melts into the
//    page (low opacity + a fade to the page bg). Content sits on top in dark
//    ink as a sibling; use it as `absolute inset-0` behind a relative content
//    layer. This reads as atmosphere, not a banner photo.
export function CityPoster({
  destinationId, cityHe, className, orientation = "landscape",
  position = "50% 34%", overlay = false, ambient = false, children,
}: {
  destinationId?: number | null;
  cityHe?: string | null;
  className?: string;
  orientation?: "banner" | "landscape" | "portrait";
  position?: string;
  overlay?: boolean;
  ambient?: boolean;
  children?: React.ReactNode;
}) {
  const srcs = posterSrcs(destinationId, orientation);
  const [idx, setIdx] = useState(0);
  const src = srcs[idx];

  return (
    <div className={`relative overflow-hidden ${ambient ? "bg-[var(--bg)]" : "bg-[var(--brand-soft)]"} ${className ?? ""}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={cityHe ? `פוסטר ${cityHe}` : ""} loading="lazy"
          onError={() => setIdx((i) => i + 1)}
          className="absolute inset-0 size-full object-cover"
          style={{ objectPosition: position, opacity: ambient ? 0.85 : 1, filter: GRADE }} />
      ) : (
        <PosterFallback ambient={ambient} />
      )}
      {ambient && (
        // a light, even cream veil softens the poster (atmosphere, not a crisp
        // photo) while the bottom edge melts into the page so it isn't a banner.
        <div className="absolute inset-0" style={{
          background:
            "linear-gradient(to top, var(--bg) 0%, color-mix(in srgb, var(--bg) 24%, transparent) 15%, color-mix(in srgb, var(--bg) 24%, transparent) 100%)",
        }} />
      )}
      {overlay && !ambient && (
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(16,29,43,.62), rgba(16,29,43,.05) 58%)" }} />
      )}
      {children && <div className="absolute inset-0">{children}</div>}
    </div>
  );
}

// Warm brand gradient + a faint pin — for cities without a poster yet.
function PosterFallback({ ambient }: { ambient?: boolean }) {
  if (ambient) {
    return (
      <div className="absolute inset-0"
        style={{ background: "linear-gradient(160deg, var(--brand-soft) 0%, var(--bg) 60%, var(--accent-soft) 130%)" }} />
    );
  }
  return (
    <div className="absolute inset-0"
      style={{ background: "linear-gradient(135deg, var(--brand) 0%, #14806f 52%, var(--accent) 150%)" }}>
      <svg className="absolute -bottom-5 -left-3 opacity-[0.18]" width="128" height="128" viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
        <path d="M12 2.2c-3.9 0-7 3.1-7 7 0 4.9 5.8 11.3 6.6 12.1a.55.55 0 0 0 .8 0c.8-.8 6.6-7.2 6.6-12.1 0-3.9-3.1-7-7-7z" />
      </svg>
    </div>
  );
}
