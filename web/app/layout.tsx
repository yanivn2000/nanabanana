import type { Metadata, Viewport } from "next";
import { Assistant, Fredoka } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";
import { SITE_URL } from "@/lib/site";

const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Brand headline face — Fredoka: rounded geometric sans, warm + modern, with
// full Hebrew support. Drives the .serif display class (headings, wordmark).
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL), // resolves OG/canonical relative URLs for SEO
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
    <html lang="he" dir="rtl" className={`${assistant.variable} ${fredoka.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TopNav />
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
