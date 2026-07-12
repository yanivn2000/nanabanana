"use client";

import { useState } from "react";
import { posterSrc } from "@/lib/posters";

// City poster with a graceful brand-gradient fallback. Fills its container
// (object-cover); the poster art keeps the landmark centered with sky headroom,
// so `position` can bias the crop for wide bands. `overlay` adds a bottom scrim
// so overlaid Hebrew titles stay legible; `children` render on top.
export function CityPoster({
  destinationId, cityHe, className, position = "50% 36%", overlay = false, children,
}: {
  destinationId?: number | null;
  cityHe?: string | null;
  className?: string;
  position?: string;
  overlay?: boolean;
  children?: React.ReactNode;
}) {
  const src = posterSrc(destinationId);
  const [failed, setFailed] = useState(false);
  const showImg = !!src && !failed;

  return (
    <div className={`relative overflow-hidden bg-[var(--brand-soft)] ${className ?? ""}`}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt={cityHe ? `פוסטר ${cityHe}` : ""} loading="lazy"
          onError={() => setFailed(true)}
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
