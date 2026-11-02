export type ParsedSitemap = { kind: "urlset" | "index" | "unknown"; locs: string[] };

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/**
 * Extrae las <loc> de un sitemap. No usa un parser XML a propósito: no resuelve entidades
 * externas ni DTD, así que no hay riesgo de XXE ni de expansión de entidades.
 */
export function parseSitemap(xml: string, maxLocs = 2000): ParsedSitemap {
  const head = xml.slice(0, 2000).toLowerCase();
  const kind = head.includes("<sitemapindex") ? "index" : head.includes("<urlset") ? "urlset" : "unknown";
  if (kind === "unknown") return { kind, locs: [] };
  const locs: string[] = [];
  const re = /<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/loc>/gi;
  for (let m = re.exec(xml); m && locs.length < maxLocs; m = re.exec(xml)) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (raw) locs.push(decodeEntities(raw));
  }
  return { kind, locs };
}
