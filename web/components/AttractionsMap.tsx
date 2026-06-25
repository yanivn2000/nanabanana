"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Attraction } from "@/lib/db";

const CAT_COLOR: Record<string, string> = {
  nature: "#1d9e75",
  museum: "#185fa5",
  attraction: "#d85a30",
  sport: "#ba7517",
  food: "#7f77dd",
  shopping: "#d4537e",
};
const CAT_HE: Record<string, string> = {
  nature: "טבע", museum: "מוזיאון", attraction: "אטרקציה", sport: "ספורט",
  food: "אוכל", shopping: "קניות", tourism: "תיירות", leisure: "פנאי", historic: "היסטורי",
};

export default function AttractionsMap({
  attractions,
  center,
}: {
  attractions: Attraction[];
  center: [number, number];
}) {
  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      {attractions.map((a) => (
        <CircleMarker
          key={a.id}
          center={[a.lat as number, a.lng as number]}
          radius={6}
          pathOptions={{
            color: CAT_COLOR[a.category] ?? "#888",
            fillColor: CAT_COLOR[a.category] ?? "#888",
            fillOpacity: 0.8,
            weight: 1,
          }}
        >
          <Popup>
            <div style={{ direction: "rtl", fontFamily: "sans-serif", minWidth: 160 }}>
              <strong>{a.name_he || a.name_en}</strong>
              <br />
              <span style={{ color: "#666", fontSize: 12 }}>
                {CAT_HE[a.category] ?? a.category}
                {a.family_score ? ` · ציון ${a.family_score}/10` : ""}
              </span>
              {a.tips_he && (
                <>
                  <br />
                  <span style={{ fontSize: 12 }}>{a.tips_he}</span>
                </>
              )}
              {a.website && (
                <>
                  <br />
                  <a href={a.website} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    אתר רשמי
                  </a>
                </>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
