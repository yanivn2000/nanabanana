"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import type { CircleMarker as LeafletCircleMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Attraction } from "@/lib/db";
import { catColor, categoryHe as CAT_HE_FN } from "@/lib/labels";

// Flies to the selected attraction and opens its popup when selection changes.
function Flyer({
  selected,
  markers,
}: {
  selected: Attraction | null;
  markers: React.RefObject<Map<number, LeafletCircleMarker>>;
}) {
  const map = useMap();
  // Defensive: recompute size after mount in case the container grew
  // (mobile 260px → desktop full-height) before Leaflet measured it.
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [map]);
  useEffect(() => {
    if (!selected?.lat || !selected?.lng) return;
    map.flyTo([selected.lat, selected.lng], 15, { duration: 0.7 });
    const m = markers.current.get(selected.id);
    if (m) setTimeout(() => m.openPopup(), 400);
  }, [selected, map, markers]);
  return null;
}

// Frame the map to the current set of points whenever it changes (e.g. when
// filtering to a single day). Skips while a specific marker is selected.
function FitBounds({ attractions, selected }: { attractions: Attraction[]; selected: Attraction | null }) {
  const map = useMap();
  const sig = attractions.map((a) => a.id).join(",");
  useEffect(() => {
    if (selected) return;
    const pts = attractions
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => [a.lat as number, a.lng as number] as [number, number]);
    if (pts.length === 1) map.setView(pts[0], 14);
    else if (pts.length > 1) {
      setTimeout(() => map.fitBounds(pts, { padding: [36, 36], maxZoom: 15 }), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

// Numbered pin (used in trip view to show stop order along the route).
function numberedIcon(n: number, color: string) {
  return L.divIcon({
    className: "num-pin",
    html: `<div style="background:${color};color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 12px/1 sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">${n}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

function AttractionPopup({ a }: { a: Attraction }) {
  return (
    <Popup>
      <div style={{ direction: "rtl", fontFamily: "sans-serif", minWidth: 170 }}>
        {a.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.image_url} alt="" style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
        )}
        <strong>{a.name_he || a.name_en}</strong>
        <br />
        <span style={{ color: "#666", fontSize: 12 }}>
          {a.tagline_he || CAT_HE_FN(a.category)}
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
  );
}

export default function AttractionsMap({
  attractions,
  center,
  selected,
  ordered,
}: {
  attractions: Attraction[];
  center: [number, number];
  selected: Attraction | null;
  ordered?: boolean;
}) {
  const markers = useRef<Map<number, LeafletCircleMarker>>(new Map());
  const routePts = ordered
    ? attractions.filter((a) => a.lat != null && a.lng != null)
        .map((a) => [a.lat as number, a.lng as number] as [number, number])
    : [];

  return (
    <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}
                  scrollWheelZoom={false}>
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <Flyer selected={selected} markers={markers} />
      <FitBounds attractions={attractions} selected={selected} />

      {ordered && routePts.length > 1 && (
        <Polyline positions={routePts}
          pathOptions={{ color: "#d85a30", weight: 2.5, opacity: 0.65, dashArray: "5 7" }} />
      )}

      {ordered
        ? attractions
            .filter((a) => a.lat != null && a.lng != null)
            .map((a, i) => (
              <Marker key={a.id} position={[a.lat as number, a.lng as number]}
                icon={numberedIcon(i + 1, catColor(a.category))}>
                <AttractionPopup a={a} />
              </Marker>
            ))
        : attractions.map((a) => (
            <CircleMarker
              key={a.id}
              center={[a.lat as number, a.lng as number]}
              radius={selected?.id === a.id ? 9 : 6}
              ref={(m) => {
                if (m) markers.current.set(a.id, m);
              }}
              pathOptions={{
                color: catColor(a.category),
                fillColor: catColor(a.category),
                fillOpacity: selected?.id === a.id ? 1 : 0.8,
                weight: selected?.id === a.id ? 3 : 1,
              }}
            >
              <AttractionPopup a={a} />
            </CircleMarker>
          ))}
    </MapContainer>
  );
}
