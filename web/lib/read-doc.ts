// Client-side file → plain text for the insights-ingest tool.
// Handles .txt/.md directly and .docx by parsing the ZIP + inflating
// word/document.xml with the browser's built-in DecompressionStream — no
// dependency, no server round-trip. (.doc/.pdf are not supported; convert first.)

function xmlToText(xml: string): string {
  // Word wraps each visible run in <w:t>…</w:t>; paragraphs end at </w:p>.
  const paras = xml.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const p of paras) {
    const runs = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
    let line = runs.map((s) => s.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, "")).join("");
    line = line
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
    if (line.trim()) lines.push(line.trim());
  }
  return lines.join("\n");
}

async function docxToText(buf: ArrayBuffer): Promise<string> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // Read the ZIP End-Of-Central-Directory record (scan back from the tail).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 22 - 65536; i--)
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("קובץ ה-docx אינו תקין (לא נמצא ZIP).");
  const cdOffset = dv.getUint32(eocd + 16, true);
  const cdCount = dv.getUint16(eocd + 10, true);
  // Walk the central directory to locate word/document.xml (the body text).
  let p = cdOffset;
  const entries: { name: string; method: number; comp: number; lho: number }[] = [];
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const comp = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, comp, lho });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const target = entries.filter((e) => e.name === "word/document.xml");
  if (!target.length) throw new Error("לא נמצא תוכן טקסט ב-docx.");
  let xml = "";
  for (const e of target) {
    // Local header: 30 bytes + filename + extra, then the file data.
    const lnameLen = dv.getUint16(e.lho + 26, true);
    const lextraLen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + lnameLen + lextraLen;
    const data = u8.subarray(start, start + e.comp);
    let bytes: Uint8Array;
    if (e.method === 0) {
      bytes = data;                                   // stored (uncompressed)
    } else {
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Blob([data]).stream().pipeThrough(ds);
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    xml += new TextDecoder().decode(bytes) + "\n";
  }
  return xmlToText(xml);
}

export async function fileToText(f: File): Promise<string> {
  const name = f.name.toLowerCase();
  if (name.endsWith(".docx")) return (await docxToText(await f.arrayBuffer())).trim();
  if (name.endsWith(".pdf") || name.endsWith(".doc"))
    throw new Error("PDF / DOC אינם נתמכים — שמרו כ-DOCX או TXT, או הדביקו את הטקסט.");
  return (await f.text()).trim();                     // txt / md / csv / plain
}

// Split long text into distill-sized chunks at paragraph (newline) boundaries,
// so a huge document (a thread of many travellers) is processed in bounded
// Claude calls instead of one over-length request that overflows max_tokens.
export function chunkText(t: string, max = 40000): string[] {
  if (t.length <= max) return [t];
  const chunks: string[] = [];
  let cur = "";
  for (const line of t.split(/\n/)) {
    if (cur && cur.length + line.length + 1 > max) { chunks.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}
