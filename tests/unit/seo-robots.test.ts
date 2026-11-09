import { describe, expect, it } from "vitest";
import { MAX_CRAWL_DELAY_MS, parseRobots, parseSitemapDocument, SEO_USER_AGENT } from "@/server/domain/seo-robots";

const SITE = "https://acme.test/";

describe("robots.txt", () => {
  it("sin robots.txt todo está permitido", () => {
    for (const text of [null, "", "   \n"]) {
      const r = parseRobots(SITE, text);
      expect(r.isAllowed("https://acme.test/privado")).toBe(true);
      expect(r.blocksAll).toBe(false);
      expect(r.sitemaps).toEqual([]);
      expect(r.crawlDelayMs).toBeNull();
    }
  });

  it("respeta Disallow y Allow para el agente del rastreador y para *", () => {
    const r = parseRobots(SITE, "User-agent: *\nDisallow: /privado\nAllow: /privado/publico\n");
    expect(r.isAllowed("https://acme.test/privado/x")).toBe(false);
    expect(r.isAllowed("https://acme.test/privado/publico")).toBe(true);
    expect(r.isAllowed("https://acme.test/")).toBe(true);
    const own = parseRobots(SITE, "User-agent: PageSpeedAOC-SEO\nDisallow: /solo-nosotros\n\nUser-agent: *\nDisallow:\n");
    expect(own.isAllowed("https://acme.test/solo-nosotros")).toBe(false);
    expect(own.isAllowed("https://acme.test/otra")).toBe(true);
  });

  it("detecta el bloqueo de todo el sitio", () => {
    expect(parseRobots(SITE, "User-agent: *\nDisallow: /\n").blocksAll).toBe(true);
    expect(parseRobots(SITE, "User-agent: *\nDisallow: /privado\n").blocksAll).toBe(false);
    expect(parseRobots(SITE, "User-agent: Googlebot\nDisallow: /\n").blocksAll).toBe(false);
  });

  it("lee los sitemaps declarados y el Crawl-delay acotado", () => {
    const r = parseRobots(SITE, "User-agent: *\nCrawl-delay: 2\nSitemap: https://acme.test/s1.xml\nSitemap: https://acme.test/s2.xml\n");
    expect(r.sitemaps).toEqual(["https://acme.test/s1.xml", "https://acme.test/s2.xml"]);
    expect(r.crawlDelayMs).toBe(2000);
    expect(parseRobots(SITE, "User-agent: *\nCrawl-delay: 120\n").crawlDelayMs).toBe(MAX_CRAWL_DELAY_MS);
  });

  it("el agente de usuario lleva el nombre y la versión", () => {
    expect(SEO_USER_AGENT).toBe("PageSpeedAOC-SEO/1.0");
  });
});

describe("sitemap", () => {
  it("lee direcciones, lastmod y los idiomas alternativos de xhtml:link", () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
      <url><loc>https://acme.test/es/</loc><lastmod>2026-10-01</lastmod>
        <xhtml:link rel="alternate" hreflang="es" href="https://acme.test/es/"/>
        <xhtml:link rel='alternate' hreflang='en' href='https://acme.test/en/'/>
        <xhtml:link rel="stylesheet" hreflang="fr" href="https://acme.test/fr/"/></url>
      <url><loc><![CDATA[https://acme.test/a?x=1&amp;y=2]]></loc></url>
      <url><loc>  https://acme.test/b&amp;c  </loc></url>
      <url><lastmod>2026-01-01</lastmod></url>
    </urlset>`;
    const doc = parseSitemapDocument(xml);
    expect(doc.kind).toBe("urlset");
    expect(doc.entries).toEqual([
      { loc: "https://acme.test/es/", lastmod: "2026-10-01", alternates: [{ lang: "es", href: "https://acme.test/es/" }, { lang: "en", href: "https://acme.test/en/" }] },
      { loc: "https://acme.test/a?x=1&amp;y=2", lastmod: null, alternates: [] },
      { loc: "https://acme.test/b&c", lastmod: null, alternates: [] },
    ]);
  });

  it("un índice devuelve los sitemaps hijos y no las páginas", () => {
    const doc = parseSitemapDocument(`<sitemapindex><sitemap><loc>https://acme.test/a.xml</loc></sitemap><sitemap><loc>https://acme.test/b.xml</loc><lastmod>2026-01-01</lastmod></sitemap></sitemapindex>`);
    expect(doc).toEqual({ kind: "index", entries: [], children: ["https://acme.test/a.xml", "https://acme.test/b.xml"] });
  });

  it("lo que no es un sitemap se reconoce como desconocido (HTML, vacío, XML de otro tipo)", () => {
    for (const body of ["<html><body>404</body></html>", "", `<rss><channel><item><link>https://acme.test/</link></item></channel></rss>`]) {
      expect(parseSitemapDocument(body)).toEqual({ kind: "unknown", entries: [], children: [] });
    }
  });

  it("no resuelve entidades externas ni DTD (sin XXE) y limita el número de entradas", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset><url><loc>&x;</loc></url></urlset>`;
    expect(parseSitemapDocument(xxe).entries.map((e) => e.loc)).toEqual(["&x;"]);
    const many = `<urlset>${Array.from({ length: 50 }, (_, i) => `<url><loc>https://acme.test/${i}</loc></url>`).join("")}</urlset>`;
    expect(parseSitemapDocument(many, 10).entries).toHaveLength(10);
  });
});
