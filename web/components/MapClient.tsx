"use client";

import dynamic from "next/dynamic";
import type { Attraction } from "@/lib/db";

// Leaflet needs the browser — load the map only on the client.
const AttractionsMap = dynamic(() => import("./AttractionsMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[var(--surface-2)] text-sm text-[var(--text-3)]">
      טוען מפה…
    </div>
  ),
});

export function MapClient(props: {
  attractions: Attraction[];
  center: [number, number];
}) {
  return <AttractionsMap {...props} />;
}
