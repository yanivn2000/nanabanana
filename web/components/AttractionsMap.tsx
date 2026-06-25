"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import type { CircleMarker as LeafletCircleMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Attraction } from "@/lib/db";

const CAT_COLOR: Record<string, string> = {
  nature: "#1d9e75", museum: "#185fa5", attraction: "#d85a30",
  sport: "#ba7517", food: "#7f77dd", shopping: "#d4537e",
};
const CAT_HE: Record<string, string> = {
  nature: "טבע", museum: "מוזיאון", attraction: "אטרקציה", sport: "ספורט",
  food: "אוכל", shopping: "קניות", tourism: "תיירות", leisure: "פנאי", historic: "היסטורי",
};

// Flies to the selected attraction and opens its popup when selection changes.
function Flyer({
  selected,
  markers,
}: {
  selected: Attraction | null;
  markers: React.RefObject<Map<number, LeafletCircleMarker>>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!selected?.lat || !selected?.lng) return;
    map.flyTo([selected.lat, selected.lng], 15, { duration: 0.7 });
    const m = markers.current.get(selected.id);
    if (m) setTimeout(() => m.openPopup(), 400);
  }, [selected, map, markers]);
  return null;
}

export default function AttractionsMap({
  attractions,
  center,
  selected,
}: {
  attractions: Attraction[];
  center: [number, number];
  selected: Attraction | null;
}) {
  const markers = useRef<Map<number, LeafletCircleMarker>>(new Map());

  return (
    <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}
                  scrollWheelZoom={false}>
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <Flyer selected={selected} markers={markers} />
      {attractions.map((a) => (
        <CircleMarker
          key={a.id}
          center={[a.lat as number, a.lng as number]}
          radius={selected?.id === a.id ? 9 : 6}
          ref={(m) => {
            if (m) markers.current.set(a.id, m);
          }}
          pathOptions={{
            color: CAT_COLOR[a.category] ?? "#888",
            fillColor: CAT_COLOR[a.category] ?? "#888",
            fillOpacity: selected?.id === a.id ? 1 : 0.8,
            weight: selected?.id === a.id ? 3 : 1,
          }}
        >
          <Popup>
            <div style={{ direction: "rtl", fontFamily: "sans-serif", minWidth: 170 }}>
              {a.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.image_url} alt="" style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
              )}
              <strong>{a.name_he || a.name_en}</strong>
              <br />
              <span style={{ color: "#666", fontSize: 12 }}>
                {a.tagline_he || CAT_HE[a.category] || a.category}
                {a.family_score ? ` · ${a.family_score}/10` : ""}
              </span>
              {a.website && (
                <>
                  <br />
                  <a href={a.website} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>אתר רשמי</a>
                </>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
