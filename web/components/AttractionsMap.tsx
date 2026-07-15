"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { CircleMarker as LeafletCircleMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Attraction } from "@/lib/db";
import { catColor, categoryHe as CAT_HE_FN, bigImage, segColor } from "@/lib/labels";

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

export type MapHotel = { id: string; name: string; lat: number; lng: number };


// Frame the map to the current set of points whenever it changes (e.g. when
// filtering to a single day). Hotels are always included so they stay in view.
// Skips while a specific marker is selected.
function FitBounds({
  attractions, hotels, selected, userPos,
}: { attractions: Attraction[]; hotels: MapHotel[]; selected: Attraction | null; userPos?: [number, number] | null }) {
  const map = useMap();
  // Signature by position (not just id) — trip stops use per-day indexes as
  // ids, so two days with the same stop count would otherwise look identical
  // and the map would stay framed on the previous day.
  const sig = [
    ...attractions.map((a) => `${a.id}:${a.lat},${a.lng}`),
    ...hotels.map((h) => "h" + h.id),
    userPos ? "u" : "",
  ].join(",");
  useEffect(() => {
    if (selected) return;
    const pts = [
      ...attractions.filter((a) => a.lat != null && a.lng != null)
        .map((a) => [a.lat as number, a.lng as number] as [number, number]),
      ...hotels.map((h) => [h.lat, h.lng] as [number, number]),
      ...(userPos ? [userPos] : []),
    ];
    if (pts.length === 1) map.setView(pts[0], 14);
    else if (pts.length > 1) {
      setTimeout(() => map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

// Flies to a focused point (e.g. a hotel clicked in the list). The nonce
// retriggers the fly even when the same hotel is clicked again.
function FlyTo({ focus }: { focus: { lat: number; lng: number; n: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], 15, { duration: 0.7 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);
  return null;
}

// Distinct hotel marker — a teal rounded pin with a bed glyph.
function hotelIcon() {
  const bed = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>';
  return L.divIcon({
    className: "hotel-pin",
    html: `<div style="background:#0e6b5e;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${bed}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  });
}

// Numbered pin (used in trip view to show stop order along the route). `active`
// enlarges the pin and rings it; `dim` fades stops the user isn't hovering so
// the focused one stands out.
function numberedIcon(n: number, color: string, active = false, dim = false) {
  const size = active ? 32 : 24;
  const ring = active ? ",0 0 0 4px " + color + "33" : "";
  return L.divIcon({
    className: "num-pin",
    html: `<div style="background:${color};color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 ${active ? 14 : 12}px/1 sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)${ring};opacity:${dim ? 0.4 : 1};transition:all .15s">${n}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function AttractionPopup({ a }: { a: Attraction }) {
  return (
    <Popup>
      <div style={{ direction: "rtl", fontFamily: "sans-serif", width: 230 }}>
        {a.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bigImage(a.image_url)} alt=""
            onError={(e) => { const t = e.currentTarget; if (t.src !== a.image_url) t.src = a.image_url as string; }}
            style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 8, marginBottom: 6, display: "block" }} />
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

export type MapBounds = { north: number; south: number; east: number; west: number };

// Reports the visible viewport bounds to the parent on pan/zoom (and on mount),
// so the list can show only what's currently on the map.
function BoundsReporter({ onBounds }: { onBounds?: (b: MapBounds) => void }) {
  const last = useRef("");
  const report = (map: L.Map) => {
    if (!onBounds) return;
    const b = map.getBounds();
    const nb = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    // Only report when the viewport ACTUALLY changed. A programmatic fit/fly
    // fires moveend → onBounds → setState → re-render; this guard stops an
    // identical re-report from looping and cuts redundant re-renders.
    const key = [nb.north, nb.south, nb.east, nb.west].map((n) => n.toFixed(4)).join();
    if (key === last.current) return;
    last.current = key;
    onBounds(nb);
  };
  const map = useMapEvents({
    moveend: () => report(map),
    zoomend: () => report(map),
  });
  useEffect(() => { report(map); /* initial */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function userIcon() {
  return L.divIcon({
    className: "user-dot",
    html: '<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.18),0 1px 4px rgba(0,0,0,.4)"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

export default function AttractionsMap({
  attractions,
  center,
  selected,
  ordered,
  hotels = [],
  focus = null,
  segIdx,
  colorBySegment = false,
  colors,
  activeIdx = null,
  onStopClick,
  userPos = null,
  onBounds,
}: {
  attractions: Attraction[];
  center: [number, number];
  selected: Attraction | null;
  ordered?: boolean;
  hotels?: MapHotel[];
  focus?: { lat: number; lng: number; n: number } | null;
  segIdx?: number[];
  colorBySegment?: boolean;
  colors?: string[];              // explicit per-stop colour (trip view: the day palette)
  activeIdx?: number | null;      // hovered/opened stop — enlarge it, fade the rest
  onStopClick?: (i: number) => void;
  userPos?: [number, number] | null;
  onBounds?: (b: MapBounds) => void;
}) {
  const markers = useRef<Map<number, LeafletCircleMarker>>(new Map());
  const orderedPts = ordered
    ? attractions.filter((a) => a.lat != null && a.lng != null)
    : [];
  // Colour of stop i: explicit day palette when given, else by segment/category.
  const stopHue = (a: Attraction, i: number) =>
    colors?.[i] ?? (colorBySegment && segIdx ? segColor(segIdx[i] ?? 0) : catColor(a.category));

  return (
    <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}
                  scrollWheelZoom={false}>
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <Flyer selected={selected} markers={markers} />
      <FitBounds attractions={attractions} hotels={hotels} selected={selected} userPos={userPos} />
      <FlyTo focus={focus} />
      <BoundsReporter onBounds={onBounds} />

      {userPos && (
        <Marker position={userPos} icon={userIcon()} zIndexOffset={2000}>
          <Popup>
            <div style={{ direction: "rtl", fontFamily: "sans-serif" }}>
              <strong>📍 כאן אתם</strong>
            </div>
          </Popup>
        </Marker>
      )}

      {hotels.map((h) => (
        <Marker key={"h" + h.id} position={[h.lat, h.lng]} icon={hotelIcon()} zIndexOffset={1000}>
          <Popup>
            <div style={{ direction: "rtl", fontFamily: "sans-serif" }}>
              <strong>🏨 {h.name}</strong>
              <br />
              <span style={{ color: "#666", fontSize: 12 }}>המלון שלכם</span>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Route as one coloured segment per leg — each takes the colour of the
          stop it leads TO, so the line, the pin and the timeline row all match.
          Solid (a confirmed leg); the active leg (into/out of the hovered stop)
          stays bright while the rest fade. */}
      {ordered && orderedPts.slice(1).map((a, i) => {
        const from = orderedPts[i], to = a;
        const near = activeIdx != null && (activeIdx === i || activeIdx === i + 1);
        const faded = activeIdx != null && !near;
        return (
          <Polyline key={"seg" + i}
            positions={[[from.lat as number, from.lng as number], [to.lat as number, to.lng as number]]}
            pathOptions={{ color: stopHue(to, i + 1), weight: near ? 4 : 3,
              opacity: faded ? 0.25 : 0.7 }} />
        );
      })}

      {ordered
        ? orderedPts.map((a, i) => (
              <Marker key={a.id} position={[a.lat as number, a.lng as number]}
                icon={numberedIcon(i + 1, stopHue(a, i),
                  activeIdx === i, activeIdx != null && activeIdx !== i)}
                eventHandlers={onStopClick ? { click: () => onStopClick(i) } : undefined}>
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
