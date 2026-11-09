import { describe, expect, it } from "vitest";
import type { PageFacts } from "@/server/domain/seo-crawl-parse";
import {
  diffIssues,
  evaluate,
  groupByCode,
  ISSUE_CATALOG,
  ISSUE_CODES,
  SITE,
  sortIssues,
  summarize,
  type CrawledPage,
  type Issue,
  type IssueCode,
  type SiteFacts,
} from "@/server/domain/seo-crawl-rules";
import type { Market } from "@/server/domain/seo-markets";

const BASE = "https://acme.test";
const ES: Market = { lang: "es", prefix: "/" };
const EN: Market = { lang: "en", prefix: "/en" };

const facts = (path: string, over: Partial<PageFacts> = {}): PageFacts => ({
  title: `Título correcto y descriptivo de la página ${path}`,
  description: `Descripción de la página ${path}`,
  h1Count: 1,
  canonical: `${BASE}${path}`,
  robots: [],
  htmlLang: "es",
  hreflang: [],
  links: [],
  jsonLd: { invalid: 0, items: [] },
  textLength: 500,
  ...over,
});

type PageOver = Partial<Omit<CrawledPage, "facts">> & { facts?: Partial<PageFacts> | null };
const page = (path: string, over: PageOver = {}): CrawledPage => ({
  path,
  status: 200,
  finalPath: null,
  hops: 0,
  loop: false,
  contentType: "text/html",
  xRobots: [],
  blockedByRobots: false,
  inSitemap: true,
  ...over,
  facts: over.facts === null ? null : facts(path, over.facts),
});

const healthySite = (over: Partial<SiteFacts> = {}): SiteFacts => ({
  hosts: ["acme.test"],
  robots: { status: 200, blocksAll: false },
  sitemaps: [{ url: `${BASE}/sitemap.xml`, status: 200, kind: "urlset" }],
  sitemapDeclaredInRobots: true,
  httpRedirectsToHttps: true,
  truncated: false,
  ...over,
});

const org = { type: "Organization", props: ["name", "url", "logo"] };
/** Portada con Organization que enlaza a /a y /b; ambas enlazan de vuelta. */
const healthyPages = (): CrawledPage[] => [
  page("/", { facts: { links: [`${BASE}/a`, `${BASE}/b`], jsonLd: { invalid: 0, items: [org] } } }),
  page("/a", { facts: { links: [`${BASE}/`] } }),
  page("/b", { facts: { links: [`${BASE}/`] } }),
];

const seen = new Set<IssueCode>();
function run(pages: CrawledPage[] = healthyPages(), over: { site?: Partial<SiteFacts>; markets?: Market[] } = {}): Issue[] {
  const issues = evaluate({ pages, site: healthySite(over.site), markets: over.markets ?? [] });
  for (const i of issues) seen.add(i.code);
  return issues;
}
const codes = (issues: Issue[]) => issues.map((i) => i.code);
const on = (issues: Issue[], code: IssueCode) => issues.filter((i) => i.code === code).map((i) => i.page);
/** Sustituye una página de la portada sana. */
const withPage = (path: string, over: PageOver) => healthyPages().map((p) => (p.path === path ? page(path, { ...over, facts: over.facts === null ? null : { links: p.facts?.links ?? [], ...over.facts } }) : p));

describe("línea base", () => {
  it("un sitio sano no produce ningún hallazgo", () => {
    expect(run()).toEqual([]);
  });

  it("el catálogo tiene gravedad, grupo, título y qué hacer para cada código", () => {
    for (const code of ISSUE_CODES) {
      const e = ISSUE_CATALOG[code];
      expect(["error", "warning", "info"]).toContain(e.severity);
      expect(e.title.length).toBeGreaterThan(5);
      expect(e.advice.length).toBeGreaterThan(20);
    }
  });
});

describe("acceso", () => {
  it("página con error 4xx, 5xx o sin respuesta que nadie enlaza (por ejemplo, del sitemap), con su estado", () => {
    for (const status of [404, 500, 0]) {
      const issues = run([...healthyPages(), page("/sola", { status, facts: null })]);
      expect(on(issues, "status_error")).toEqual(["/sola"]);
      expect(issues.find((i) => i.code === "status_error")?.evidence).toMatchObject({ status, inSitemap: true });
    }
  });

  it("una página con error que sí enlazan otras se informa una sola vez, como enlace roto", () => {
    const issues = run(withPage("/a", { status: 404, facts: null }));
    expect(on(issues, "broken_link")).toEqual(["/a"]);
    expect(on(issues, "status_error")).toEqual([]);
    expect(issues.find((i) => i.code === "broken_link")?.evidence).toMatchObject({ status: 404, count: 1, from: ["/"], inSitemap: true });
  });

  it("bucle de redirecciones: se informa como bucle y no además como página con error", () => {
    const issues = run([...healthyPages(), page("/sola", { loop: true, hops: 5, status: 0, facts: null })]);
    expect(on(issues, "redirect_loop")).toEqual(["/sola"]);
    expect(on(issues, "status_error")).toEqual([]);
  });

  it("cadena de más de un salto, pero no un solo salto", () => {
    expect(on(run(withPage("/a", { hops: 2, finalPath: "/b" })), "redirect_chain")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { hops: 1, finalPath: "/b" })), "redirect_chain")).toEqual([]);
  });

  it("http sin redirección a https es del sitio; no comprobado no es hallazgo", () => {
    expect(on(run(healthyPages(), { site: { httpRedirectsToHttps: false } }), "http_not_redirected")).toEqual([SITE]);
    expect(on(run(healthyPages(), { site: { httpRedirectsToHttps: null } }), "http_not_redirected")).toEqual([]);
  });

  it("enlace roto: un hallazgo por destino, con las páginas que lo enlazan", () => {
    const pages = [
      page("/", { facts: { links: [`${BASE}/a`, `${BASE}/roto`], jsonLd: { invalid: 0, items: [org] } } }),
      page("/a", { facts: { links: [`${BASE}/`, `${BASE}/roto`] } }),
      page("/roto", { status: 404, facts: null, inSitemap: false }),
    ];
    const issues = run(pages);
    expect(on(issues, "broken_link")).toEqual(["/roto"]);
    expect(issues.find((i) => i.code === "broken_link")?.evidence).toMatchObject({ count: 2, from: ["/", "/a"], status: 404 });
  });

  it("no cuenta como roto un enlace a otro host, a una página no rastreada ni a una bloqueada por robots", () => {
    const pages = [
      page("/", { facts: { links: ["https://otro.test/x", `${BASE}/no-rastreada`, `${BASE}/privado`, `${BASE}/a`], jsonLd: { invalid: 0, items: [org] } } }),
      page("/a", { facts: { links: [`${BASE}/`] } }),
      page("/privado", { blockedByRobots: true, status: 0, facts: null, inSitemap: false }),
    ];
    expect(on(run(pages), "broken_link")).toEqual([]);
  });

  it("los enlaces con www o con otra mayúscula en el host cuentan como internos", () => {
    const pages = [
      page("/", { facts: { links: ["https://WWW.acme.test/a", `${BASE}/roto`], jsonLd: { invalid: 0, items: [org] } } }),
      page("/a", { facts: { links: [`${BASE}/`] } }),
      page("/roto", { status: 410, facts: null, inSitemap: false }),
    ];
    expect(on(run(pages), "broken_link")).toEqual(["/roto"]);
  });

  it("huérfana: en el sitemap y sin enlaces entrantes; no la portada, no si el rastreo se truncó", () => {
    const pages = [...healthyPages(), page("/sola")];
    expect(on(run(pages), "orphan_page")).toEqual(["/sola"]);
    expect(on(run(pages, { site: { truncated: true } }), "orphan_page")).toEqual([]);
    expect(on(run([page("/", { facts: { jsonLd: { invalid: 0, items: [org] } } })]), "orphan_page")).toEqual([]);
    // Enlazarse a sí misma no la saca de la orfandad.
    expect(on(run([...healthyPages(), page("/sola", { facts: { links: [`${BASE}/sola`] } })]), "orphan_page")).toEqual(["/sola"]);
    // Una página fuera del sitemap sin enlaces no es huérfana en este sentido: nadie la ofrece.
    expect(on(run([...healthyPages(), page("/suelta", { inSitemap: false })]), "orphan_page")).toEqual([]);
  });
});

describe("indexación", () => {
  it("URL del sitemap con noindex, por meta o por cabecera", () => {
    expect(on(run(withPage("/a", { facts: { robots: ["noindex"] } })), "sitemap_url_noindex")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { xRobots: ["noindex"] })), "sitemap_url_noindex")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { facts: null, xRobots: ["none"], contentType: "application/pdf" })), "sitemap_url_noindex")).toEqual(["/a"]);
    // Fuera del sitemap, un noindex es una decisión legítima.
    expect(on(run(withPage("/a", { inSitemap: false, facts: { robots: ["noindex"] } })), "sitemap_url_noindex")).toEqual([]);
  });

  it("URL del sitemap bloqueada por robots.txt; y si no está en el sitemap, no es hallazgo", () => {
    expect(on(run(withPage("/a", { blockedByRobots: true, status: 0, facts: null })), "sitemap_url_blocked")).toEqual(["/a"]);
    expect(codes(run(withPage("/a", { blockedByRobots: true, status: 0, facts: null, inSitemap: false })))).not.toContain("sitemap_url_blocked");
  });

  it("URL del sitemap redirigida, con su destino", () => {
    const issues = run(withPage("/a", { hops: 1, finalPath: "/b" }));
    expect(on(issues, "sitemap_url_redirected")).toEqual(["/a"]);
    expect(issues.find((i) => i.code === "sitemap_url_redirected")?.evidence).toEqual({ to: "/b" });
  });

  it("robots.txt: ausente (404) o ilegible (500, sin respuesta, 403)", () => {
    expect(on(run(healthyPages(), { site: { robots: { status: 404, blocksAll: false } } }), "robots_missing")).toEqual([SITE]);
    for (const status of [500, 0, 403]) {
      expect(on(run(healthyPages(), { site: { robots: { status, blocksAll: false } } }), "robots_unreadable")).toEqual([SITE]);
    }
  });

  it("sitio entero bloqueado", () => {
    expect(on(run(healthyPages(), { site: { robots: { status: 200, blocksAll: true } } }), "site_blocked")).toEqual([SITE]);
  });

  it("sitemap ausente (404) o ilegible (500, HTML, sin respuesta)", () => {
    expect(on(run(healthyPages(), { site: { sitemaps: [{ url: `${BASE}/sitemap.xml`, status: 404, kind: "unknown" }] } }), "sitemap_missing")).toEqual([SITE]);
    expect(on(run(healthyPages(), { site: { sitemaps: [] } }), "sitemap_missing")).toEqual([SITE]);
    for (const s of [{ status: 500, kind: "unknown" as const }, { status: 200, kind: "unknown" as const }, { status: 0, kind: "unknown" as const }]) {
      expect(on(run(healthyPages(), { site: { sitemaps: [{ url: `${BASE}/sitemap.xml`, ...s }] } }), "sitemap_unreadable")).toEqual([SITE]);
    }
  });

  it("un sitemap bueno basta aunque otro candidato falle", () => {
    const sitemaps = [
      { url: `${BASE}/sitemap.xml`, status: 404, kind: "unknown" as const },
      { url: `${BASE}/sitemap_index.xml`, status: 200, kind: "index" as const },
    ];
    expect(codes(run(healthyPages(), { site: { sitemaps } }))).toEqual([]);
  });

  it("sitemap que robots.txt no declara; si robots.txt falta, solo se avisa de eso", () => {
    expect(on(run(healthyPages(), { site: { sitemapDeclaredInRobots: false } }), "sitemap_not_in_robots")).toEqual([SITE]);
    const missing = run(healthyPages(), { site: { sitemapDeclaredInRobots: false, robots: { status: 404, blocksAll: false } } });
    expect(codes(missing)).toEqual(["robots_missing"]);
  });
});

describe("canónica", () => {
  it("falta", () => {
    expect(on(run(withPage("/a", { facts: { canonical: null } })), "canonical_missing")).toEqual(["/a"]);
  });

  it("apunta a una página con error o redirigida", () => {
    const err = run([...healthyPages(), page("/muerta", { status: 404, facts: null, inSitemap: false })].map((p) => (p.path === "/a" ? page("/a", { facts: { links: [`${BASE}/`], canonical: `${BASE}/muerta` } }) : p)));
    expect(on(err, "canonical_target_bad")).toEqual(["/a"]);
    const redirected = run([...healthyPages(), page("/vieja", { hops: 1, finalPath: "/b", inSitemap: false })].map((p) => (p.path === "/a" ? page("/a", { facts: { links: [`${BASE}/`], canonical: `${BASE}/vieja` } }) : p)));
    expect(on(redirected, "canonical_target_bad")).toEqual(["/a"]);
  });

  it("una canónica a otra página sana (consolidación) no es hallazgo", () => {
    expect(codes(run(withPage("/a", { facts: { canonical: `${BASE}/b` } })))).toEqual([]);
  });

  it("apunta a otro idioma", () => {
    const pages = [
      page("/", { facts: { links: [`${BASE}/en`, `${BASE}/a`], jsonLd: { invalid: 0, items: [org] } } }),
      page("/a", { facts: { links: [`${BASE}/`], canonical: `${BASE}/en/a` } }),
      page("/en", { facts: { htmlLang: "en", links: [`${BASE}/`] } }),
      page("/en/a", { facts: { htmlLang: "en", links: [`${BASE}/`] } }),
    ];
    const issues = run(pages, { markets: [ES, EN] });
    expect(on(issues, "canonical_other_language")).toEqual(["/a"]);
    expect(issues.find((i) => i.code === "canonical_other_language")?.evidence).toEqual({ canonical: "/en/a", expected: "es", found: "en" });
    // Sin idiomas declarados no hay de qué comparar.
    expect(on(run(pages), "canonical_other_language")).toEqual([]);
  });
});

describe("contenido", () => {
  it("título ausente o vacío", () => {
    expect(on(run(withPage("/a", { facts: { title: null } })), "title_missing")).toEqual(["/a"]);
    const empty = run(withPage("/a", { facts: { title: "" } }));
    expect(on(empty, "title_missing")).toEqual(["/a"]);
    expect(on(empty, "title_length")).toEqual([]);
  });

  it("título corto o largo; 30 y 60 caracteres exactos están bien", () => {
    expect(on(run(withPage("/a", { facts: { title: "Corto" } })), "title_length")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { facts: { title: "x".repeat(61) } })), "title_length")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { facts: { title: "t".repeat(30) } })), "title_length")).toEqual([]);
    expect(on(run(withPage("/a", { facts: { title: "u".repeat(60) } })), "title_length")).toEqual([]);
  });

  it("títulos y descripciones repetidos, sin distinguir mayúsculas; cada página dice con cuáles", () => {
    const same = "Un título que comparten dos páginas del sitio";
    const issues = run(
      healthyPages().map((p) => (p.path === "/" ? p : page(p.path, { facts: { links: [`${BASE}/`], title: p.path === "/a" ? same : same.toUpperCase(), description: "Misma descripción" } }))),
    );
    expect(on(issues, "title_duplicate")).toEqual(["/a", "/b"]);
    expect(on(issues, "description_duplicate")).toEqual(["/a", "/b"]);
    expect(issues.find((i) => i.code === "title_duplicate" && i.page === "/a")?.evidence).toEqual({ count: 2, also: ["/b"] });
  });

  it("las páginas con noindex no cuentan como duplicadas ni se auditan en contenido", () => {
    const pages = healthyPages().map((p) => (p.path === "/" ? p : page(p.path, { inSitemap: false, facts: { links: [`${BASE}/`], robots: ["noindex"], title: null, description: null, h1Count: 0, canonical: null } })));
    const issues = run(pages);
    for (const code of ["title_missing", "description_missing", "h1_missing", "canonical_missing", "title_duplicate"] as const) expect(on(issues, code)).toEqual([]);
  });

  it("meta description ausente o de más de 160 caracteres; 160 exactos está bien", () => {
    expect(on(run(withPage("/a", { facts: { description: null } })), "description_missing")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { facts: { description: "" } })), "description_missing")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { facts: { description: "d".repeat(161) } })), "description_long")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { facts: { description: "d".repeat(160) } })), "description_long")).toEqual([]);
  });

  it("sin h1 y con varios h1", () => {
    expect(on(run(withPage("/a", { facts: { h1Count: 0 } })), "h1_missing")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { facts: { h1Count: 3 } })), "h1_multiple")).toEqual(["/a"]);
  });

  it("contenido dibujado en el navegador: se avisa y no se juzgan sus datos", () => {
    const issues = run(withPage("/a", { facts: { textLength: 0, h1Count: 0, title: null, description: null, canonical: null, htmlLang: null } }));
    expect(codes(issues)).toEqual(["client_rendered"]);
    expect(on(issues, "client_rendered")).toEqual(["/a"]);
  });
});

describe("idiomas", () => {
  it("sin lang, con y sin idiomas declarados", () => {
    expect(on(run(withPage("/a", { facts: { htmlLang: null } })), "lang_missing")).toEqual(["/a"]);
    expect(on(run(withPage("/a", { facts: { htmlLang: null } }), { markets: [ES] }), "lang_missing")).toEqual(["/a"]);
  });

  it("lang distinto del idioma de la ruta; acepta regiones y mayúsculas", () => {
    const pages = [
      page("/", { facts: { links: [`${BASE}/en/x`, `${BASE}/en/y`], jsonLd: { invalid: 0, items: [org] } } }),
      page("/en/x", { facts: { htmlLang: "es", links: [`${BASE}/`] } }),
      page("/en/y", { facts: { htmlLang: "EN-us", links: [`${BASE}/`] } }),
    ];
    const issues = run(pages, { markets: [ES, EN] });
    expect(on(issues, "lang_mismatch")).toEqual(["/en/x"]);
    expect(issues.find((i) => i.code === "lang_mismatch")?.evidence).toEqual({ lang: "es", expected: "en" });
    expect(on(run(pages), "lang_mismatch")).toEqual([]);
  });

  it("el hallazgo de una página lleva su idioma", () => {
    const pages = [
      page("/", { facts: { links: [`${BASE}/en/x`], jsonLd: { invalid: 0, items: [org] } } }),
      page("/en/x", { facts: { htmlLang: "es", links: [`${BASE}/`] } }),
    ];
    const issue = run(pages, { markets: [ES, EN] }).find((i) => i.code === "lang_mismatch");
    expect(issue?.lang).toBe("en");
    expect(run(pages, { markets: [ES, EN] }).find((i) => i.page === SITE)?.lang ?? null).toBeNull();
  });

  const alt = (lang: string, path: string) => ({ lang, href: `${BASE}${path}` });
  /** /es y /en que se enlazan como alternativas. */
  const bilingual = (esAlts: Array<{ lang: string; href: string }>, enAlts: Array<{ lang: string; href: string }>, over: { es?: PageOver; en?: PageOver } = {}) => [
    page("/", { facts: { links: [`${BASE}/en`], hreflang: esAlts, jsonLd: { invalid: 0, items: [org] }, ...over.es?.facts } , ...over.es }),
    page("/en", { facts: { htmlLang: "en", links: [`${BASE}/`], hreflang: enAlts, ...over.en?.facts }, ...over.en }),
  ];
  const good = [alt("es", "/"), alt("en", "/en"), alt("x-default", "/")];

  it("hreflang completo y recíproco no produce hallazgos", () => {
    expect(run(bilingual(good, good), { markets: [ES, EN] })).toEqual([]);
  });

  it("código inválido", () => {
    const issues = run(bilingual([...good, alt("espanol", "/"), alt("es_MX", "/")], good), { markets: [ES, EN] });
    expect(on(issues, "hreflang_invalid_code")).toEqual(["/"]);
    expect(issues.find((i) => i.code === "hreflang_invalid_code")?.evidence).toEqual({ codes: ["espanol", "es_MX"] });
    for (const ok of ["es", "es-MX", "zh-Hans", "zh-Hans-CN", "x-default", "es-419"]) {
      expect(on(run(bilingual([...good, alt(ok, "/")], good), { markets: [ES, EN] }), "hreflang_invalid_code")).toEqual([]);
    }
  });

  it("sin enlace a sí misma", () => {
    expect(on(run(bilingual([alt("en", "/en")], good), { markets: [ES, EN] }), "hreflang_no_self")).toEqual(["/"]);
  });

  it("no recíproco: la alternativa no devuelve el enlace", () => {
    const issues = run(bilingual(good, [alt("en", "/en")]), { markets: [ES, EN] });
    expect(on(issues, "hreflang_not_reciprocal")).toEqual(["/"]);
    expect(issues.find((i) => i.code === "hreflang_not_reciprocal")?.evidence).toEqual({ targets: ["/en"] });
  });

  it("varios códigos que apuntan a la misma página se informan una sola vez", () => {
    // es y x-default apuntan a «/»; /en no la devuelve.
    const issues = run(bilingual([alt("es", "/"), alt("en", "/en"), alt("x-default", "/en"), alt("en-GB", "/en")], [alt("en", "/en")]), { markets: [ES, EN] });
    expect(issues.find((i) => i.code === "hreflang_not_reciprocal")?.evidence).toEqual({ targets: ["/en"] });
  });

  it("la alternativa no se puede verificar si no se rastreó: no se acusa", () => {
    const pages = [page("/", { facts: { hreflang: good, jsonLd: { invalid: 0, items: [org] } } })];
    expect(codes(run(pages, { markets: [ES, EN] }))).not.toContain("hreflang_not_reciprocal");
  });

  it("la alternativa da error, redirige, tiene noindex o declara otra canónica", () => {
    const targets: PageOver[] = [
      { status: 404, facts: null },
      { hops: 1, finalPath: "/otra" },
      { facts: { robots: ["noindex"], hreflang: good } },
      { facts: { canonical: `${BASE}/otra`, hreflang: good } },
    ];
    for (const t of targets) {
      const issues = run(bilingual(good, good, { en: { inSitemap: false, ...t } }), { markets: [ES, EN] });
      expect(on(issues, "hreflang_target_bad")).toEqual(["/"]);
    }
  });

  it("el código declarado no coincide con el idioma de la ruta destino", () => {
    const issues = run(bilingual([alt("es", "/"), alt("fr", "/en")], good), { markets: [ES, EN] });
    expect(on(issues, "hreflang_wrong_language")).toEqual(["/"]);
    expect(issues.find((i) => i.code === "hreflang_wrong_language")?.evidence).toEqual({ targets: ["/en"] });
    // x-default puede apuntar a cualquier idioma.
    expect(on(run(bilingual([...good.slice(0, 2), alt("x-default", "/en")], good), { markets: [ES, EN] }), "hreflang_wrong_language")).toEqual([]);
  });

  it("proyecto con varios idiomas y ninguna página con hreflang", () => {
    const pages = bilingual([], []);
    expect(on(run(pages, { markets: [ES, EN] }), "hreflang_absent")).toEqual([SITE]);
    expect(on(run(pages, { markets: [ES] }), "hreflang_absent")).toEqual([]);
    expect(on(run(pages), "hreflang_absent")).toEqual([]);
  });

  it("falta x-default solo importa si hay hreflang", () => {
    const noDefault = [alt("es", "/"), alt("en", "/en")];
    expect(on(run(bilingual(noDefault, noDefault), { markets: [ES, EN] }), "x_default_missing")).toEqual([SITE]);
    expect(on(run(bilingual([], []), { markets: [ES, EN] }), "x_default_missing")).toEqual([]);
  });

  it("idioma declarado sin ninguna página; no si el rastreo se truncó", () => {
    const pages = healthyPages();
    const issues = run(pages, { markets: [ES, EN] });
    expect(on(issues, "language_without_pages")).toEqual([SITE]);
    expect(issues.find((i) => i.code === "language_without_pages")?.evidence).toEqual({ languages: ["en"] });
    expect(on(run(pages, { markets: [ES, EN], site: { truncated: true } }), "language_without_pages")).toEqual([]);
  });
});

describe("datos estructurados", () => {
  it("JSON-LD inválido", () => {
    expect(on(run(withPage("/a", { facts: { jsonLd: { invalid: 2, items: [] } } })), "jsonld_invalid")).toEqual(["/a"]);
  });

  it("tipo conocido sin sus propiedades; los alternativos a|b|c bastan con uno", () => {
    const missing = run(withPage("/a", { facts: { jsonLd: { invalid: 0, items: [{ type: "Product", props: ["name"] }, { type: "https://schema.org/Article", props: ["headline"] }] } } }));
    expect(on(missing, "jsonld_missing_props")).toEqual(["/a"]);
    expect(missing.find((i) => i.code === "jsonld_missing_props")?.evidence).toEqual({ missing: ["Product: offers|review|aggregateRating", "Article: author, datePublished"] });
    const ok = run(withPage("/a", { facts: { jsonLd: { invalid: 0, items: [{ type: "Product", props: ["name", "review"] }, { type: "Restaurant", props: [] }, { type: "ListItem", props: [] }] } } }));
    expect(on(ok, "jsonld_missing_props")).toEqual([]);
  });

  it("portada sin Organization, WebSite ni LocalBusiness", () => {
    expect(on(run(withPage("/", { facts: { jsonLd: { invalid: 0, items: [] } } })), "jsonld_home_missing")).toEqual([SITE]);
    expect(on(run(withPage("/", { facts: { jsonLd: { invalid: 0, items: [{ type: "LocalBusiness", props: ["name", "address"] }] } } })), "jsonld_home_missing")).toEqual([]);
    // Sin portada rastreada no se puede afirmar nada.
    expect(on(run([page("/a")]), "jsonld_home_missing")).toEqual([]);
  });
});

describe("resultados", () => {
  const sample: Issue[] = [
    { code: "title_length", severity: "warning", page: "/b", lang: null, evidence: {} },
    { code: "status_error", severity: "error", page: "/z", lang: null, evidence: {} },
    { code: "status_error", severity: "error", page: "/a", lang: null, evidence: {} },
    { code: "client_rendered", severity: "info", page: "/c", lang: null, evidence: {} },
    { code: "title_length", severity: "warning", page: "/a", lang: null, evidence: {} },
  ];

  it("se ordenan por gravedad, código y página, y el resultado no cambia con el orden de entrada", () => {
    expect(sortIssues(sample).map((i) => `${i.code}${i.page}`)).toEqual(["status_error/a", "status_error/z", "title_length/a", "title_length/b", "client_rendered/c"]);
    const pages = [...healthyPages(), page("/c", { status: 404, facts: null }), page("/d", { facts: { title: null } })];
    expect(run(pages)).toEqual(run([...pages].reverse()));
  });

  it("cuenta por gravedad y agrupa por código, de más a menos grave y de más a menos páginas", () => {
    expect(summarize(sample)).toEqual({ error: 2, warning: 2, info: 1 });
    expect(summarize([])).toEqual({ error: 0, warning: 0, info: 0 });
    expect(groupByCode(sample)).toEqual([
      { code: "status_error", severity: "error", pages: 2 },
      { code: "title_length", severity: "warning", pages: 2 },
      { code: "client_rendered", severity: "info", pages: 1 },
    ]);
  });

  it("compara dos rastreos: nuevos, persistentes y resueltos", () => {
    const before = [
      { page: "/a", code: "status_error" },
      { page: "/b", code: "title_missing" },
    ];
    const after = [
      { page: "/b", code: "title_missing" },
      { page: "/c", code: "h1_missing" },
    ];
    expect(diffIssues(before, after)).toEqual({
      added: [{ page: "/c", code: "h1_missing" }],
      persistent: [{ page: "/b", code: "title_missing" }],
      resolved: [{ page: "/a", code: "status_error" }],
    });
    expect(diffIssues([], after).added).toHaveLength(2);
    expect(diffIssues(after, []).resolved).toHaveLength(2);
  });

  it("cada código del catálogo se ejercitó en alguna prueba de este archivo", () => {
    expect(ISSUE_CODES.filter((code) => !seen.has(code))).toEqual([]);
  });
});
