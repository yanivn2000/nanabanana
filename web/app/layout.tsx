import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "NanaBanana · מתכננים טיול",
  description:
    "האפליקציה שבונה לכם את הטיול המשפחתי המושלם — בעברית, מותאם למשפחה שלכם.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NanaBanana" },
};

export const viewport: Viewport = {
  themeColor: "#1d9e75",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TopNav />
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
