import type { Metadata, Viewport } from "next";
import { Assistant, Fredoka, Frank_Ruhl_Libre } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";
import { NavTitleProvider } from "@/components/NavTitle";
import { SiteFooter } from "@/components/SiteFooter";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import { jsonLd, siteJsonLd } from "@/lib/seo";

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

// Editorial display face — Frank Ruhl Libre: a true Hebrew serif for the
// "Editorial Travel Planner" direction. Loaded globally, USED only inside the
// feature-flagged .editorial-scope (so live pages keep Fredoka untouched).
const frankRuhl = Frank_Ruhl_Libre({
  variable: "--font-frank",
  subsets: ["hebrew", "latin"],
  weight: ["500", "700", "800", "900"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL), // resolves OG/canonical relative URLs for SEO
  // A template so every page keeps the brand without repeating it by hand, and a
  // home title built from what an Israeli searches: the act, not the product name.
  title: {
    default: "Yalle · בונה לכם מסלול טיול בעברית — חינם",
    template: "%s",
  },
  description:
    "בוחרים יעד, מסמנים מה מעניין, ומקבלים מסלול טיול יום־אחר־יום בעברית — עם זמנים, מפה והפסקות אוכל. 65 יעדים, מותאם למשפחות, לזוגות ולחברים. בחינם, בלי הרשמה.",
  alternates: { canonical: "/" },
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
    <html lang="he" dir="rtl" className={`${assistant.variable} ${fredoka.variable} ${frankRuhl.variable} h-full antialiased`}>
      <body className="min-h-full">
        <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(siteJsonLd())} />
        <NavTitleProvider>
          <TopNav />
          {children}
        </NavTitleProvider>
        <SiteFooter />
        <BottomNav />
        <Analytics />
      </body>
    </html>
  );
}
