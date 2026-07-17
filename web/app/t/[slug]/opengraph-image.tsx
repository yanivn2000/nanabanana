import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSharedTrip, getPosterPick } from "@/lib/db";

// The Facebook/WhatsApp preview card — this IS the ad when a trip link lands
// in a travel group: destination photo, Hebrew title, trip stats, Yalle mark.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori (the OG renderer) has no bidi — Hebrew comes out mirrored. Apply the
// visual order manually: reverse word order, reverse chars inside Hebrew words
// (mirroring brackets), leave latin/digit runs intact.
const HEB = /[֐-׿]/;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{" };
function rtl(s: string): string {
  return s.split(" ").map((w) =>
    HEB.test(w)
      ? [...w].reverse().map((ch) => MIRROR[ch] ?? ch).join("")
      : w
  ).reverse().join(" ");
}

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const trip = await getSharedTrip(slug);
  const [reg, bold] = await Promise.all([
    readFile(path.join(process.cwd(), "assets/fonts/Assistant-Regular.ttf")),
    readFile(path.join(process.cwd(), "assets/fonts/Assistant-Bold.ttf")),
  ]);
  const pick = trip?.destination_id ? await getPosterPick(trip.destination_id) : null;
  const bg = pick ? `${pick.src_url}?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop` : null;
  const days = trip?.itinerary.days.length ?? 0;
  const stops = trip?.itinerary.days.reduce((n, d) => n + d.stops.length, 0) ?? 0;

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "flex-end", position: "relative", fontFamily: "Assistant",
        background: "linear-gradient(135deg, #0e6b5e 0%, #14806f 60%, #c96f4a 140%)",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {bg && <img src={bg} width={1200} height={630}
          style={{ position: "absolute", inset: 0, objectFit: "cover" }} />}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(10,20,18,0.88) 0%, rgba(10,20,18,0.25) 55%, rgba(10,20,18,0.15) 100%)",
        }} />
        {/* Yalle mark */}
        <div style={{
          position: "absolute", top: 36, left: 48, display: "flex", alignItems: "center",
          background: "rgba(255,248,238,0.94)", borderRadius: 999, padding: "10px 26px",
        }}>
          <span style={{ fontSize: 34, fontWeight: 700, color: "#0e6b5e" }}>{rtl("Yalle · יאלה")}</span>
        </div>
        {/* text block (RTL) */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", padding: "0 56px 48px", gap: 14 }}>
          <div style={{ display: "flex", fontSize: 62, fontWeight: 700, color: "#ffffff", textAlign: "right", lineHeight: 1.15, maxWidth: 1050 }}>
            {rtl(trip?.title ?? "טיול ב-Yalle")}
          </div>
          <div style={{ display: "flex", flexDirection: "row-reverse", gap: 12 }}>
            {[`${days} ימים`, `${stops} עצירות`, ...(trip?.composition ? [trip.composition] : []), "יום-אחר-יום עם מפה"].map((chip) => (
              <div key={chip} style={{
                display: "flex", background: "rgba(255,248,238,0.92)", color: "#20342f",
                borderRadius: 999, padding: "8px 22px", fontSize: 26, fontWeight: 700,
              }}>{rtl(chip)}</div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Assistant", data: reg, weight: 400 },
        { name: "Assistant", data: bold, weight: 700 },
      ],
    }
  );
}
