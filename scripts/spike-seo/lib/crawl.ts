import { classifyPath, type Market } from "./lang";
import { hostOf, pagePath } from "./urls";

/** Extracción mínima con expresiones regulares: basta para estimar esfuerzo. El rastreador real es de la fase 2. */

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** URLs (o sitemaps hijos, si es un índice) de un sitemap XML. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => decode(m[1] ?? "")).filter(Boolean);
  return /<sitemapindex/i.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

/** Elige hasta `n` URLs repartidas por igual entre los idiomas, para que cada uno quede representado. */
export function samplePages(urls: string[], markets: Market[], defaultLang: string | undefined, n: number): string[] {
  const groups = new Map<string, string[]>();
  for (const url of urls) {
    const lang = classifyPath(url, markets, defaultLang).lang ?? "sin-idioma";
    const list = groups.get(lang) ?? [];
    list.push(url);
    groups.set(lang, list);
  }
  const picked: string[] = [];
  const lists = [...groups.values()];
  for (let i = 0; picked.length < n && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const url = l[i];
      if (url && picked.length < n) picked.push(url);
    }
  }
  return picked;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[(m[1] ?? "").toLowerCase()] = decode(m[2] ?? m[3] ?? "");
  return out;
}

function typesIn(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) return node.forEach((n) => typesIn(n, found));
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") found.add(t);
  else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && found.add(x));
  for (const v of Object.values(obj)) typesIn(v, found);
}

export type PageSeo = {
  url: string;
  title: string | null;
  description: string | null;
  canonical: string | null;
  htmlLang: string | null;
  robots: string | null;
  h1Count: number;
  hreflang: Array<{ lang: string; href: string }>;
  jsonLdTypes: string[];
  jsonLdErrors: number;
};

/** Datos SEO básicos de una página HTML. */
export function extractSeo(html: string, url: string): PageSeo {
  const metas = [...html.matchAll(/<meta\b([^>]*)>/gi)].map((m) => attrs(m[1] ?? ""));
  const links = [...html.matchAll(/<link\b([^>]*)>/gi)].map((m) => attrs(m[1] ?? ""));
  const meta = (name: string) => metas.find((m) => m.name?.toLowerCase() === name)?.content ?? null;

  const found = new Set<string>();
  let jsonLdErrors = 0;
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      typesIn(JSON.parse(m[1] ?? ""), found);
    } catch {
      jsonLdErrors += 1;
    }
  }

  return {
    url,
    title: decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null,
    description: meta("description"),
    canonical: links.find((l) => l.rel?.toLowerCase() === "canonical")?.href ?? null,
    htmlLang: html.match(/<html[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1] ?? null,
    robots: meta("robots"),
    h1Count: (html.match(/<h1\b/gi) ?? []).length,
    hreflang: links.filter((l) => l.rel?.toLowerCase() === "alternate" && l.hreflang && l.href).map((l) => ({ lang: l.hreflang ?? "", href: l.href ?? "" })),
    jsonLdTypes: [...found].sort(),
    jsonLdErrors,
  };
}

export type HreflangIssue = { page: string; problem: string };

/**
 * Revisa el `hreflang` solo entre las páginas rastreadas: que cada una se declare a sí misma y que
 * cada alternativa rastreada la devuelva (reciprocidad).
 */
export function checkHreflang(pages: PageSeo[]): HreflangIssue[] {
  const byPath = new Map(pages.map((p) => [pagePath(p.url), p]));
  const issues: HreflangIssue[] = [];
  for (const p of pages) {
    if (p.hreflang.length === 0) continue;
    const me = pagePath(p.url);
    if (!p.hreflang.some((h) => pagePath(h.href) === me)) issues.push({ page: p.url, problem: "no se declara a sí misma en hreflang" });
    for (const h of p.hreflang) {
      const other = byPath.get(pagePath(h.href));
      if (!other || other === p) continue;
      if (!other.hreflang.some((x) => pagePath(x.href) === me)) issues.push({ page: p.url, problem: `${h.href} no devuelve el enlace (falta reciprocidad)` });
    }
  }
  return issues;
}

/** Solo se rastrean URLs del mismo host que el sitio, aunque el sitemap diga otra cosa. */
export function sameHost(url: string, siteUrl: string): boolean {
  const a = hostOf(url);
  return a !== null && a === hostOf(siteUrl);
}
