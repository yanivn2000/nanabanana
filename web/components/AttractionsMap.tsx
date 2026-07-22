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
    if (!selected || !Number.isFinite(selected.lat as number) || !Number.isFinite(selected.lng as number)) return;
    // gentle: pan to the place but keep neighbourhood context (13-14), instead
    // of a hard zoom-15 that hides every attraction around it. Guard getZoom()
    // (can be NaN mid-init) so we never fly to an invalid view.
    const cz = map.getZoom();
    const z = Math.max(13, Math.min(Number.isFinite(cz) ? cz : 14, 14));
    const to: [number, number] = [selected.lat as number, selected.lng as number];
    // Animated flyTo reads map.getCenter() internally, which THROWS if the map's
    // current view is ever NaN. Fall back to a hard, non-animated setView (which
    // sets the center directly, without reading the old one) so a corrupted view
    // self-heals on the first click instead of crashing the map.
    try {
      map.flyTo(to, z, { duration: 0.6 });
    } catch {
      map.setView(to, z, { animate: false });
    }
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
      ...attractions.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng))
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
    if (!focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lng)) return;
    const to: [number, number] = [focus.lat, focus.lng];
    // flyTo reads map.getCenter() (throws if the current view is NaN); fall back to
    // a non-animated setView so a not-yet-sized map can't crash the click.
    try { map.flyTo(to, 15, { duration: 0.7 }); }
    catch { map.setView(to, 15, { animate: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);
  return null;
}

// Frames the map to the traveler's picks on demand (a button, via the nonce),
// so every selected place fits in view. Only fires when the nonce increments —
// marking/unmarking never reframes the map on its own.
function FitToPicks({ picks, nonce }: { picks: Attraction[]; nonce: number }) {
  const map = useMap();
  useEffect(() => {
    if (!nonce) return;
    const pts = picks.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng))
      .map((a) => [a.lat as number, a.lng as number] as [number, number]);
    if (pts.length === 1) map.flyTo(pts[0], 14, { duration: 0.6 });
    else if (pts.length > 1) map.flyToBounds(pts, { padding: [55, 55], maxZoom: 15, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
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

function AttractionPopup({ a, action }: { a: Attraction; action?: { label: string; onClick: () => void; active?: boolean; danger?: boolean } }) {
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
        {action && (
          <button onClick={action.onClick}
            style={{ marginTop: 8, width: "100%", padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 12.5, fontWeight: 600, color: "#fff",
              background: action.active ? "#6b7280" : action.danger ? "#c0392b" : "#0e6b5e" }}>
            {action.label}
          </button>
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
  picks = [],
  fitNonce = 0,
  hoveredId = null,
  extras = [],
  pendingAddIds,
  pendingRemoveLocated,
  onToggleExtra,
  onToggleRemove,
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
  picks?: Attraction[];           // the traveler's כן/אולי marks — highlighted + framed on demand
  fitNonce?: number;              // increment to frame the map to `picks`
  hoveredId?: number | null;      // card hovered in the list — grow its marker
  extras?: Attraction[];          // left-out picks shown as GREY markers (map day-editing)
  pendingAddIds?: Set<number>;    // extra ids marked to add this day → turn green
  pendingRemoveLocated?: Set<number>; // located indices marked to remove → turn red
  onToggleExtra?: (id: number) => void;   // click a grey marker
  onToggleRemove?: (i: number) => void;   // remove a placed stop (by located index)
}) {
  const markers = useRef<Map<number, LeafletCircleMarker>>(new Map());
  const orderedPts = ordered
    ? attractions.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng))
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
      <FitToPicks picks={picks} nonce={fitNonce} />
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

      {/* left-out picks as GREY markers (day-editing): click → mark to add (turns
          green). They let the traveller see un-placed picks near the planned route. */}
      {ordered && extras.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng)).map((a) => {
        const marked = pendingAddIds?.has(a.id);
        return (
          <CircleMarker key={"x" + a.id} center={[a.lat as number, a.lng as number]}
            radius={marked ? 8 : 6}
            pathOptions={{ color: "#fff", weight: 2, fillColor: marked ? "#0e6b5e" : "#9aa0a6", fillOpacity: 0.9 }}>
            <AttractionPopup a={a} action={onToggleExtra ? {
              label: marked ? "✓ יתווסף ליום · בטל" : "➕ הוסף ליום זה",
              onClick: () => onToggleExtra(a.id), active: marked } : undefined} />
          </CircleMarker>
        );
      })}

      {ordered
        ? orderedPts.map((a, i) => {
              const rm = pendingRemoveLocated?.has(i);
              return (
              <Marker key={a.id} position={[a.lat as number, a.lng as number]}
                icon={numberedIcon(i + 1, rm ? "#c0392b" : stopHue(a, i),
                  activeIdx === i, activeIdx != null && activeIdx !== i)}
                eventHandlers={onStopClick ? { click: () => onStopClick(i) } : undefined}>
                <AttractionPopup a={a} action={onToggleRemove ? {
                  label: rm ? "✓ יוסר מהיום · בטל" : "🗑 הסר מהיום",
                  onClick: () => onToggleRemove(i), active: rm, danger: true } : undefined} />
              </Marker>
            );
            })
        : attractions.map((a) => (
            <CircleMarker
              key={a.id}
              center={[a.lat as number, a.lng as number]}
              radius={hoveredId === a.id ? 11 : selected?.id === a.id ? 9 : 6}
              ref={(m) => {
                if (m) markers.current.set(a.id, m);
              }}
              pathOptions={{
                color: hoveredId === a.id ? "#0e6b5e" : catColor(a.category),
                fillColor: catColor(a.category),
                fillOpacity: hoveredId === a.id || selected?.id === a.id ? 1 : 0.8,
                weight: hoveredId === a.id ? 4 : selected?.id === a.id ? 3 : 1,
              }}
            >
              <AttractionPopup a={a} />
            </CircleMarker>
          ))}

      {/* the traveler's picks — a brand-green ring on top, so selected places
          are identifiable at a glance and every one has a marker to frame */}
      {!ordered && picks.map((a) => (
        Number.isFinite(a.lat) && Number.isFinite(a.lng) && (
          <CircleMarker key={"pick" + a.id}
            center={[a.lat as number, a.lng as number]}
            radius={selected?.id === a.id ? 9 : 7}
            pathOptions={{ color: "#fff", weight: 2.5, fillColor: "#0e6b5e", fillOpacity: 1 }}>
            <AttractionPopup a={a} />
          </CircleMarker>
        )
      ))}
    </MapContainer>
  );
}
