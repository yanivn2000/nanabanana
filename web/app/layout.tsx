import type { Metadata, Viewport } from "next";
import { Assistant, Frank_Ruhl_Libre } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";

const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Brand headline face (direction B) — editorial Hebrew serif for .serif headings.
const frank = Frank_Ruhl_Libre({
  variable: "--font-frank",
  subsets: ["hebrew", "latin"],
  weight: ["500", "700", "900"],
});

export const metadata: Metadata = {
  title: "Yalle · תבנה לי טיול",
  description:
    "תבנה לי טיול — האפליקציה שבונה לכם את הטיול המשפחתי המושלם, בעברית, מותאם למשפחה שלכם.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Yalle" },
};

export const viewport: Viewport = {
  themeColor: "#0e6b5e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={`${assistant.variable} ${frank.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TopNav />
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
