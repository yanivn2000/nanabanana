// SEO helpers. Everything here is written for ONE audience: an Israeli typing
// Hebrew into Google. The queries that matter are the ones people actually use —
// "טיול לאמסטרדם", "מה לעשות בפראג עם ילדים", "מסלול טיול לרומא 4 ימים" — so the
// titles and descriptions are built around those phrases, from real numbers in
// the database rather than filler.
import { SITE_URL } from "./site";

export const canonical = (path: string) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

// Google shows ~60 chars of a Hebrew title and ~155 of a description before it
// truncates. These stay inside that, with the city name first — it is the word
// the searcher typed.
export function cityTitle(city: string): string {
  return `טיול ל${city} — מסלול יום־אחר־יום שנבנה בשבילכם | Yalle`;
}

export function cityDescription(city: string, opts: {
  mustSee: number; total: number; areas: number; streets: number;
}): string {
  const bits = [`${opts.mustSee} אתרי חובה ב${city} בעברית, עם תמונות, זמני שהייה ומפה`];
  if (opts.areas) bits.push(`${opts.areas} שכונות`);
  if (opts.streets) bits.push(`${opts.streets} רחובות מומלצים`);
  bits.push("בונים מסלול ל־3 ימים או לשבוע, עם ילדים או בלי — בחינם");
  return bits.join(" · ");
}

// A JSON-LD block. Next renders this into the SSR HTML, which is what a crawler
// reads — the page's own data is client-side and arrives too late to count.
export function jsonLd(data: Record<string, unknown> | Record<string, unknown>[]) {
  return {
    __html: JSON.stringify(data).replace(/</g, "\\u003c"),   // guard against </script>
  };
}

export const breadcrumbs = (trail: { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map((t, i) => ({
    "@type": "ListItem", position: i + 1, name: t.name, item: canonical(t.path),
  })),
});

export const siteJsonLd = () => [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Yalle",
    alternateName: "יאלה — תבנה לי טיול",
    url: SITE_URL,
    inLanguage: "he-IL",
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Yalle",
    url: SITE_URL,
    logo: `${SITE_URL}/yalle-logo.png`,
    description: "בונה מסלולי טיול בעברית לפי מי שנוסע — משפחות, זוגות או חברים.",
  },
];
