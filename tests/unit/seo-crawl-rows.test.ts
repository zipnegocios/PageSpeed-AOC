import { describe, expect, it } from "vitest";
import type { PageFacts } from "@/server/domain/seo-crawl-parse";
import { toPageRows } from "@/server/domain/seo-crawl-rows";
import type { CrawledPage } from "@/server/domain/seo-crawl-rules";

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  title: "Título",
  description: "x".repeat(120),
  h1Count: 1,
  canonical: "https://acme.test/es/precios/?utm=1",
  robots: ["noarchive"],
  htmlLang: "es",
  hreflang: [{ lang: "es", href: "https://acme.test/es/precios" }, { lang: "en", href: "https://acme.test/en/pricing?x=1" }],
  links: [],
  jsonLd: { invalid: 0, items: [{ type: "Organization", props: [] }, { type: "https://schema.org/Organization", props: [] }, { type: "WebSite", props: [] }] },
  textLength: 300,
  ...over,
});
const page = (path: string, over: Partial<CrawledPage> & { facts?: PageFacts | null } = {}): CrawledPage => ({
  path, status: 200, finalPath: null, hops: 0, loop: false, contentType: "text/html", xRobots: [], blockedByRobots: false, inSitemap: true, facts: facts(), ...over,
});

describe("filas de página para guardar", () => {
  const markets = [{ lang: "es", prefix: "/" }, { lang: "en", prefix: "/en" }];
  const site = { hosts: ["acme.test"] };

  it("guarda solo hechos: rutas normalizadas, longitud de la descripción y tipos únicos", () => {
    const [row] = toPageRows([page("/es/precios")], site, markets);
    expect(row).toMatchObject({
      path: "/es/precios",
      lang: "es",
      title: "Título",
      descriptionLength: 120,
      h1Count: 1,
      canonical: "/es/precios",
      htmlLang: "es",
      robots: ["noarchive"],
      hreflang: [{ lang: "es", path: "/es/precios" }, { lang: "en", path: "/en/pricing" }],
      jsonLdTypes: ["Organization", "WebSite"],
      inlinks: 0,
    });
    // Ni el texto de la descripción ni el HTML llegan a la fila.
    expect(JSON.stringify(row)).not.toContain("xxxxxxxx");
  });

  it("una página sin datos (error, PDF, bloqueada) guarda solo su estado", () => {
    const [row] = toPageRows([page("/rota", { status: 404, facts: null }), ], site, markets);
    expect(row).toMatchObject({ status: 404, title: null, descriptionLength: null, h1Count: null, canonical: null, htmlLang: null, robots: null, hreflang: null, jsonLdTypes: null });
  });

  it("une las directrices de robots del HTML y de la cabecera, sin repetir", () => {
    const [row] = toPageRows([page("/a", { xRobots: ["noindex", "noarchive"] })], site, markets);
    expect(row!.robots).toEqual(["noarchive", "noindex"]);
    const [header] = toPageRows([page("/doc.pdf", { facts: null, xRobots: ["noindex"] })], site, markets);
    expect(header!.robots).toEqual(["noindex"]);
  });

  it("descripción ausente cuenta como longitud 0 y un título largo se recorta", () => {
    const [row] = toPageRows([page("/a", { facts: facts({ description: null, title: "t".repeat(500) }) })], site, markets);
    expect(row!.descriptionLength).toBe(0);
    expect(row!.title).toHaveLength(300);
  });

  it("calcula idioma por prefijo (o null sin idiomas) y los enlaces entrantes", () => {
    const pages = [
      page("/", { facts: facts({ links: ["https://acme.test/en/x", "https://acme.test/en/x#a", "https://www.acme.test/en/x"] }) }),
      page("/en/x", { facts: facts({ links: ["https://acme.test/", "https://acme.test/en/x"] }) }),
      page("/otra", { facts: facts({ links: ["https://acme.test/en/x", "https://otro.test/en/x"] }) }),
    ];
    const rows = toPageRows(pages, site, markets);
    expect(rows.map((r) => [r.path, r.lang, r.inlinks])).toEqual([["/", "es", 1], ["/en/x", "en", 2], ["/otra", "es", 0]]);
    expect(toPageRows(pages, site, []).map((r) => r.lang)).toEqual([null, null, null]);
  });
});
