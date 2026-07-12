"use client";

import { useState } from "react";
import { posterSrcs } from "@/lib/posters";

// City poster with a graceful brand-gradient fallback. Fills its container
// (object-cover); poster art keeps the landmark centered with sky headroom, so
// `position` can bias the crop. `orientation` picks the crop that fits the slot
// (landscape for wide bands, portrait for tall cards) and falls back to the
// other crop if the preferred one is missing, then to the gradient. `overlay`
// adds a bottom scrim so overlaid Hebrew titles stay legible.
export function CityPoster({
  destinationId, cityHe, className, orientation = "landscape",
  position = "50% 34%", overlay = false, children,
}: {
  destinationId?: number | null;
  cityHe?: string | null;
  className?: string;
  orientation?: "banner" | "landscape" | "portrait";
  position?: string;
  overlay?: boolean;
  children?: React.ReactNode;
}) {
  const srcs = posterSrcs(destinationId, orientation);
  const [idx, setIdx] = useState(0);
  const src = srcs[idx];

  return (
    <div className={`relative overflow-hidden bg-[var(--brand-soft)] ${className ?? ""}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={cityHe ? `פוסטר ${cityHe}` : ""} loading="lazy"
          onError={() => setIdx((i) => i + 1)}
          className="absolute inset-0 size-full object-cover"
          style={{ objectPosition: position }} />
      ) : (
        <PosterFallback />
      )}
      {overlay && (
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(16,29,43,.62), rgba(16,29,43,.05) 58%)" }} />
      )}
      {children && <div className="absolute inset-0">{children}</div>}
    </div>
  );
}

// Warm brand gradient + a faint pin — for cities without a poster yet.
function PosterFallback() {
  return (
    <div className="absolute inset-0"
      style={{ background: "linear-gradient(135deg, var(--brand) 0%, #14806f 52%, var(--accent) 150%)" }}>
      <svg className="absolute -bottom-5 -left-3 opacity-[0.18]" width="128" height="128" viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
        <path d="M12 2.2c-3.9 0-7 3.1-7 7 0 4.9 5.8 11.3 6.6 12.1a.55.55 0 0 0 .8 0c.8-.8 6.6-7.2 6.6-12.1 0-3.9-3.1-7-7-7z" />
      </svg>
    </div>
  );
}
