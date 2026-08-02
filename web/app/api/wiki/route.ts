import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Resolve a Wikipedia article link to the reader's preferred language: Hebrew,
// else English, else the original. Used when the stored source is in some other
// language (e.g. the coordinate match landed on the Czech/German article). Looks
// up the article's Wikidata item and follows its he/en sitelink, 302-redirecting.
const UA = "Yalle/1.0 (hello@yalle.co)";
const H = { "User-Agent": UA } as const;
const artUrl = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

export async function GET(req: NextRequest) {
  const u = new URL(req.url).searchParams.get("u") || "";
  const m = u.match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return NextResponse.redirect(u || "https://he.wikipedia.org");
  const [, lang, titleEnc] = m;
  if (lang === "he") return NextResponse.redirect(u);
  const title = decodeURIComponent(titleEnc);
  try {
    // article → Wikidata item id
    const p = await fetch(`https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
      action: "query", prop: "pageprops", ppprop: "wikibase_item", redirects: "1",
      titles: title, format: "json",
    }), { headers: H, signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const pages = (p?.query?.pages ?? {}) as Record<string, { pageprops?: { wikibase_item?: string } }>;
    const qid = Object.values(pages)[0]?.pageprops?.wikibase_item;
    if (qid) {
      const e = await fetch(`https://www.wikidata.org/w/api.php?` + new URLSearchParams({
        action: "wbgetentities", ids: qid, props: "sitelinks", sitefilter: "hewiki|enwiki", format: "json",
      }), { headers: H, signal: AbortSignal.timeout(8000) }).then((r) => r.json());
      const sl = (e?.entities?.[qid]?.sitelinks ?? {}) as Record<string, { title: string }>;
      if (sl.hewiki?.title) return NextResponse.redirect(artUrl("he", sl.hewiki.title));
      if (sl.enwiki?.title) return NextResponse.redirect(artUrl("en", sl.enwiki.title));
    }
  } catch { /* fall through to the source */ }
  return NextResponse.redirect(u);
}
