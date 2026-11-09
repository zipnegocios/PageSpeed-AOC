import robotsParser from "robots-parser";

/**
 * `robots.txt` y sitemap vistos por el rastreador. Lógica pura: recibe el texto ya descargado. El sitemap se lee sin
 * parser XML (sin entidades externas ni DTD, igual que `domain/sitemap.ts`), pero además de las direcciones trae `lastmod`
 * y los idiomas alternativos de `<xhtml:link>`.
 */

/** Cómo se identifica el rastreador. Es lo que un cliente permitiría en su cortafuegos. */
export const SEO_AGENT = "PageSpeedAOC-SEO";
export const SEO_USER_AGENT = `${SEO_AGENT}/1.0`;

/** Pausa máxima que se acepta de `Crawl-delay`: más allá, el rastreo no terminaría en su plazo. */
export const MAX_CRAWL_DELAY_MS = 5_000;

export type RobotsRules = {
  /** ¿Puede el rastreador descargar esta dirección? Sin `robots.txt` todo está permitido. */
  isAllowed(url: string): boolean;
  sitemaps: string[];
  /** Pausa pedida por el sitio entre peticiones, acotada a `MAX_CRAWL_DELAY_MS`; null si no pide ninguna. */
  crawlDelayMs: number | null;
  /** El sitio prohíbe todo al rastreador (`Disallow: /`). */
  blocksAll: boolean;
};

export function parseRobots(siteUrl: string, text: string | null): RobotsRules {
  const origin = new URL(siteUrl).origin;
  if (text === null || text.trim() === "") return { isAllowed: () => true, sitemaps: [], crawlDelayMs: null, blocksAll: false };
  const robots = robotsParser(`${origin}/robots.txt`, text);
  const delay = robots.getCrawlDelay(SEO_AGENT);
  const isAllowed = (url: string) => robots.isAllowed(url, SEO_AGENT) !== false;
  return {
    isAllowed,
    sitemaps: robots.getSitemaps(),
    crawlDelayMs: typeof delay === "number" && delay > 0 ? Math.min(delay * 1000, MAX_CRAWL_DELAY_MS) : null,
    blocksAll: !isAllowed(`${origin}/`) && !isAllowed(`${origin}/a`),
  };
}

export type SitemapEntry = { loc: string; lastmod: string | null; alternates: Array<{ lang: string; href: string }> };
export type SitemapDocument = { kind: "urlset" | "index" | "unknown"; entries: SitemapEntry[]; children: string[] };

function decode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

const tagText = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`, "i").exec(xml);
  // Dentro de CDATA el texto es literal: las entidades no se resuelven.
  if (m?.[1] !== undefined) return m[1].trim() || null;
  const raw = (m?.[2] ?? "").trim();
  return raw ? decode(raw) : null;
};

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  const raw = m?.[1] ?? m?.[2];
  return raw ? decode(raw) : null;
}

/** Entradas de un sitemap (o los sitemaps hijos de un índice), con un tope para no cargar documentos enormes. */
export function parseSitemapDocument(xml: string, maxEntries = 5000): SitemapDocument {
  const head = xml.slice(0, 2000).toLowerCase();
  const kind = head.includes("<sitemapindex") ? "index" : head.includes("<urlset") ? "urlset" : "unknown";
  if (kind === "unknown") return { kind, entries: [], children: [] };
  if (kind === "index") {
    const children: string[] = [];
    for (const m of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
      const loc = tagText(m[1] ?? "", "loc");
      if (loc && children.length < maxEntries) children.push(loc);
    }
    return { kind, entries: [], children };
  }
  const entries: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    if (entries.length >= maxEntries) break;
    const body = m[1] ?? "";
    const loc = tagText(body, "loc");
    if (!loc) continue;
    const alternates: SitemapEntry["alternates"] = [];
    for (const link of body.matchAll(/<xhtml:link\b[^>]*>/gi)) {
      const tag = link[0];
      const rel = attr(tag, "rel");
      const lang = attr(tag, "hreflang");
      const href = attr(tag, "href");
      if (rel?.toLowerCase() === "alternate" && lang && href) alternates.push({ lang, href });
    }
    entries.push({ loc, lastmod: tagText(body, "lastmod"), alternates });
  }
  return { kind, entries, children: [] };
}
