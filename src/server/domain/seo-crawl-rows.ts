import { pagePath } from "@/server/seo/urls";
import { internalInlinks, type CrawledPage, type SiteFacts } from "./seo-crawl-rules";
import { classifyPath, type Market } from "./seo-markets";

/** La fila de una página tal como se guarda: solo hechos técnicos, nunca el HTML ni el texto. */
export type PageRow = {
  path: string;
  status: number;
  finalPath: string | null;
  hops: number;
  loop: boolean;
  contentType: string | null;
  blockedByRobots: boolean;
  inSitemap: boolean;
  lang: string | null;
  title: string | null;
  descriptionLength: number | null;
  h1Count: number | null;
  canonical: string | null;
  htmlLang: string | null;
  robots: string[] | null;
  hreflang: Array<{ lang: string; path: string }> | null;
  jsonLdTypes: string[] | null;
  inlinks: number;
};

const MAX_TITLE = 300;

/** De las páginas rastreadas a las filas que se guardan, con su idioma y sus enlaces entrantes. */
export function toPageRows(pages: CrawledPage[], site: Pick<SiteFacts, "hosts">, markets: Market[]): PageRow[] {
  const inlinks = internalInlinks(pages, site.hosts);
  return pages.map((p) => {
    const f = p.facts;
    return {
      path: p.path,
      status: p.status,
      finalPath: p.finalPath,
      hops: p.hops,
      loop: p.loop,
      contentType: p.contentType ? p.contentType.slice(0, 100) : null,
      blockedByRobots: p.blockedByRobots,
      inSitemap: p.inSitemap,
      lang: markets.length > 0 ? classifyPath(p.path, markets) : null,
      title: f?.title == null ? null : f.title.slice(0, MAX_TITLE),
      descriptionLength: f ? (f.description?.length ?? 0) : null,
      h1Count: f ? f.h1Count : null,
      canonical: f?.canonical ? pagePath(f.canonical) : null,
      htmlLang: f?.htmlLang ?? null,
      robots: f ? [...new Set([...f.robots, ...p.xRobots])] : p.xRobots.length > 0 ? p.xRobots : null,
      hreflang: f ? f.hreflang.map((h) => ({ lang: h.lang, path: pagePath(h.href) })) : null,
      jsonLdTypes: f ? [...new Set(f.jsonLd.items.map((i) => i.type.replace(/^https?:\/\/schema\.org\//i, "")))].sort() : null,
      inlinks: inlinks.get(p.path)?.size ?? 0,
    };
  });
}
