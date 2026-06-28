"use client";

import dynamic from "next/dynamic";
import type { Attraction } from "@/lib/db";

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
  selected: Attraction | null;
  ordered?: boolean;
}) {
  return <AttractionsMap {...props} />;
}
