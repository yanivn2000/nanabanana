// Server-only: fetch image + Hebrew-description CANDIDATES for an attraction, so
// the /admin content picker can offer the editor real options to choose from.
// Mirrors the wikidata_match.py approach (geosearch near the coords → entities →
// P18 image + He-Wikipedia lead), but returns choices instead of auto-applying.
import "server-only";

const UA = "Yalle/1.0 (hello@yalle.co)";
const H = { "User-Agent": UA } as const;

const norm = (s: string) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function sim(a: string, b: string): number {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const A = new Set(a.match(/.{1,2}/g) || []), B = new Set(b.match(/.{1,2}/g) || []);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

async function jget(url: string, params: Record<string, string>): Promise<unknown> {
  const u = new URL(url); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(15000) });
  return r.ok ? r.json() : null;
}

export type ImageCandidate = { url: string; label: string; source: string };
export type DescCandidate = { text: string; label: string; source: string };

// Commons file → a bounded thumbnail (same convention as existing image_urls).
const commons = (file: string, w = 800) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=${w}`;

export async function contentCandidates(nameHe: string | null, nameEn: string, lat: number, lng: number):
  Promise<{ images: ImageCandidate[]; descriptions: DescCandidate[] }> {
  const names = [nameEn, nameHe || ""].filter(Boolean);
  const images: ImageCandidate[] = [];
  const descriptions: DescCandidate[] = [];
  try {
    const geo = await jget("https://www.wikidata.org/w/api.php", {
      action: "query", list: "geosearch", gscoord: `${lat}|${lng}`,
      gsradius: "700", gslimit: "20", format: "json",
    }) as { query?: { geosearch?: { title: string }[] } } | null;
    const qids = (geo?.query?.geosearch ?? []).map((g) => g.title).slice(0, 20);
    if (!qids.length) return { images, descriptions };

    const ent = await jget("https://www.wikidata.org/w/api.php", {
      action: "wbgetentities", ids: qids.join("|"),
      props: "labels|claims|sitelinks", languages: "en|he",
      sitefilter: "hewiki|enwiki", format: "json",
    }) as { entities?: Record<string, {
      labels?: Record<string, { value: string }>;
      claims?: { P18?: { mainsnak: { datavalue?: { value: string } } }[] };
      sitelinks?: Record<string, { title: string }>;
    }> } | null;

    const scored = Object.entries(ent?.entities ?? {}).map(([qid, e]) => {
      const labs = ["en", "he"].map((l) => e.labels?.[l]?.value || "").filter(Boolean);
      const s = Math.max(0, ...labs.map((lab) => Math.max(...names.map((n) => sim(n, lab)))));
      return { qid, e, label: labs[0] || qid, s };
    }).filter((x) => x.s >= 0.45).sort((a, b) => b.s - a.s).slice(0, 6);

    const heTitles: { title: string; label: string }[] = [];
    for (const { e, label } of scored) {
      const file = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (file && !images.some((i) => i.url.includes(encodeURIComponent(file.replace(/ /g, "_")))))
        images.push({ url: commons(file), label, source: "Wikidata P18" });
      const ht = e.sitelinks?.hewiki?.title;
      if (ht) heTitles.push({ title: ht, label });
    }

    // Hebrew lead(s) from the matched articles' summaries (also a fallback image).
    for (const { title, label } of heTitles.slice(0, 4)) {
      const sum = await jget(`https://he.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {}) as
        { extract?: string; thumbnail?: { source: string }; originalimage?: { source: string } } | null;
      if (sum?.extract && sum.extract.length > 40) descriptions.push({ text: sum.extract, label, source: "ויקיפדיה עברית" });
      const img = sum?.originalimage?.source || sum?.thumbnail?.source;
      if (img && !images.some((i) => i.url === img)) images.push({ url: img, label, source: "ויקיפדיה עברית" });
    }
  } catch { /* best-effort */ }
  return { images: images.slice(0, 8), descriptions: descriptions.slice(0, 5) };
}
