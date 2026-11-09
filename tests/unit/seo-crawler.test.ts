import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "@/server/domain/seo-crawl-rules";
import { SEO_USER_AGENT } from "@/server/domain/seo-robots";
import { fetchHop, type HopResponse } from "@/server/domain/url-guard";
import { crawl, DEFAULT_LIMITS, HARD_MAX_PAGES, type CrawlOptions, type FetchHopFn } from "@/server/seo/crawler";

// ------------------------------------------------------------ sitio falso

type Spec = { status?: number; type?: string; body?: string; location?: string; xRobots?: string; fail?: boolean };
type Site = Record<string, Spec | string>;

const BASE = "https://acme.test";
const LONG_TITLE = (n: string) => `Título correcto y descriptivo de la página ${n}`;
const html = (name: string, links: string[] = [], extra = "", lang = "es") =>
  `<!doctype html><html lang="${lang}"><head><title>${LONG_TITLE(name)}</title><meta name="description" content="Descripción de ${name}"><link rel="canonical" href="${BASE}${name}">${extra}</head><body><h1>${name}</h1><p>${"texto de la página ".repeat(10)}</p>${links.map((l) => `<a href="${l}">enlace</a>`).join("")}</body></html>`;
const org = `<script type="application/ld+json">{"@type":"Organization","name":"Acme","url":"${BASE}"}</script>`;
const sitemap = (...paths: string[]) => `<urlset>${paths.map((p) => `<url><loc>${BASE}${p}</loc></url>`).join("")}</urlset>`;

/** Reloj virtual: dormir lo adelanta. Registra cada petición y cuántas había en vuelo a la vez. */
function harness(site: Site, over: { clockStep?: number } = {}) {
  let clock = 0;
  const sleeps: number[] = [];
  const log: Array<{ url: string; maxBytes: number; truncate: boolean; at: number }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const hop: FetchHopFn = async (url, o) => {
    log.push({ url, maxBytes: o.maxBytes, truncate: o.truncate, at: clock });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    clock += over.clockStep ?? 0;
    inFlight -= 1;
    const u = new URL(url);
    const key = u.protocol === "http:" ? `http:${u.pathname}` : u.pathname + (u.search ? u.search : "");
    const raw = site[key] ?? site[u.pathname];
    if (raw === undefined) return { status: 404, url, contentType: "text/html", location: null, xRobotsTag: null, text: "", truncated: false };
    const spec: Spec = typeof raw === "string" ? { body: raw } : raw;
    if (spec.fail) throw new Error("fallo de red");
    const text = spec.body ?? "";
    const cut = text.length > o.maxBytes;
    return {
      status: spec.status ?? 200,
      url,
      contentType: spec.type ?? (u.pathname.endsWith(".xml") ? "application/xml" : u.pathname === "/robots.txt" ? "text/plain" : "text/html"),
      location: spec.location ?? null,
      xRobotsTag: spec.xRobots ?? null,
      text: cut ? text.slice(0, o.maxBytes) : text,
      truncated: cut,
    };
  };
  const run = (extra: Partial<CrawlOptions> = {}) =>
    crawl({
      baseUrl: BASE,
      allowedHosts: ["acme.test", "www.acme.test"],
      fetchHop: hop,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
      ...extra,
    });
  return { run, log, sleeps, maxInFlight: () => maxInFlight, urls: () => log.map((l) => l.url) };
}

const healthy = (): Site => ({
  "/robots.txt": `User-agent: *\nSitemap: ${BASE}/sitemap.xml\n`,
  "/sitemap.xml": sitemap("/", "/a", "/b"),
  "http:/": { status: 301, location: `${BASE}/` },
  "/": html("/", ["/a", "/b"], org),
  "/a": html("/a", ["/"]),
  "/b": html("/b", ["/"]),
});

describe("rastreo de un sitio sano", () => {
  it("recorre portada, sitemap y enlaces, y las reglas no encuentran nada", async () => {
    const h = harness(healthy());
    const r = await h.run();
    expect(r.outcome).toBe("complete");
    expect(r.truncatedBy).toBeNull();
    expect(r.detail).toBeNull();
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/a", "/b"]);
    expect(r.pages.every((p) => p.status === 200 && p.facts && p.inSitemap)).toBe(true);
    expect(r.site).toMatchObject({ hosts: ["acme.test"], robots: { status: 200, blocksAll: false }, sitemapDeclaredInRobots: true, httpRedirectsToHttps: true, truncated: false });
    expect(r.site.sitemaps).toEqual([{ url: `${BASE}/sitemap.xml`, status: 200, kind: "urlset" }]);
    expect(r.discovered).toBe(3);
    expect(evaluate({ pages: r.pages, site: r.site, markets: [] })).toEqual([]);
  });

  it("cada página se pide una sola vez aunque se enlace desde varias", async () => {
    const h = harness(healthy());
    await h.run();
    const pageRequests = h.urls().filter((u) => !/robots|sitemap|^http:/.test(u));
    expect(pageRequests.sort()).toEqual([`${BASE}/`, `${BASE}/a`, `${BASE}/b`]);
  });

  it("es determinista: el mismo sitio da el mismo resultado", async () => {
    const a = await harness(healthy()).run();
    const b = await harness(healthy()).run();
    expect(a).toEqual(b);
  });

  it("siembra también las rutas pedidas y la dirección base con ruta", async () => {
    const site = { ...healthy(), "/extra": html("/extra", ["/"]) };
    const r = await harness(site).run({ seedPaths: ["/extra"] });
    expect(r.pages.map((p) => p.path)).toContain("/extra");
    expect(r.pages.find((p) => p.path === "/extra")?.inSitemap).toBe(false);
  });
});

describe("alcance", () => {
  const chain = (): Site => ({
    "/robots.txt": "",
    "/": html("/", ["/d1"], org),
    "/d1": html("/d1", ["/d2"]),
    "/d2": html("/d2", ["/d3"]),
    "/d3": html("/d3", ["/d4"]),
    "/d4": html("/d4", ["/d5"]),
  });

  it("sigue enlaces hasta 3 niveles desde la portada", async () => {
    const r = await harness(chain()).run();
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/d1", "/d2", "/d3"]);
    expect(r.outcome).toBe("complete");
  });

  it("las páginas del sitemap parten del nivel 0 aunque estén lejos de la portada", async () => {
    const r = await harness({ ...chain(), "/d5": html("/d5", ["/d6"]), "/d6": html("/d6", ["/d7"]), "/d7": html("/d7", ["/d8"]), "/d8": html("/d8"), "/sitemap.xml": sitemap("/d4") }).run();
    const paths = r.pages.map((p) => p.path);
    // /d4 es nivel 0; sus enlaces, /d5 a /d7, son niveles 1 a 3; /d8 sería el 4.
    expect(paths).toEqual(expect.arrayContaining(["/d4", "/d5", "/d6", "/d7"]));
    expect(paths).not.toContain("/d8");
  });

  it("solo rastrea los hosts permitidos; www y apex cuentan como el mismo sitio", async () => {
    const site: Site = { "/robots.txt": "", "/": html("/", ["https://www.acme.test/a", "https://otro.test/x", "https://acme.test.evil.test/y"], org), "/a": html("/a", ["/"]) };
    const h = harness(site);
    const r = await h.run();
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/a"]);
    expect(h.urls().some((u) => u.includes("otro.test") || u.includes("evil"))).toBe(false);
  });

  it("las direcciones que solo difieren en parámetros son una sola página", async () => {
    const site: Site = { "/robots.txt": "", "/": html("/", ["/p?x=1", "/p?x=2", "/p#ancla", "/p"], org), "/p": html("/p", ["/"]) };
    const h = harness(site);
    const r = await h.run();
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/p"]);
    expect(h.urls().filter((u) => u.includes("/p"))).toHaveLength(1);
  });

  it("no descarga archivos que no son páginas, ni enlaces mailto, tel o javascript", async () => {
    const site: Site = { "/robots.txt": "", "/": html("/", ["/guia.pdf", "/foto.JPG", "/app.js", "mailto:a@b.c", "tel:123", "javascript:void(0)", "/a"], org), "/a": html("/a", ["/"]) };
    const h = harness(site);
    await h.run();
    expect(h.urls().filter((u) => /pdf|jpg|\.js|mailto|tel/i.test(u))).toEqual([]);
  });

  it("una página que no es HTML se registra sin datos de contenido", async () => {
    const site: Site = { "/robots.txt": "", "/sitemap.xml": sitemap("/", "/datos"), "/": html("/", [], org), "/datos": { type: "application/json", body: '{"a":1}' } };
    const r = await harness(site).run();
    const p = r.pages.find((x) => x.path === "/datos")!;
    expect(p).toMatchObject({ status: 200, facts: null, contentType: "application/json" });
  });

  it("un sitemap con muchas direcciones se corta en el máximo de páginas y lo dice", async () => {
    const paths = Array.from({ length: 50 }, (_, i) => `/p${i}`);
    const site: Site = { "/robots.txt": "", "/sitemap.xml": sitemap(...paths), "/": html("/", [], org), ...Object.fromEntries(paths.map((p) => [p, html(p, ["/"])])) };
    const r = await harness(site).run({ limits: { maxPages: 10 } });
    expect(r.outcome).toBe("partial");
    expect(r.truncatedBy).toBe("pages");
    expect(r.detail).toContain("10 páginas");
    expect(r.pages).toHaveLength(10);
    expect(r.discovered).toBe(51);
    expect(r.site.truncated).toBe(true);
    // Un sitio truncado no produce falsas huérfanas ni idiomas sin páginas.
    expect(evaluate({ pages: r.pages, site: r.site, markets: [] }).map((i) => i.code)).not.toContain("orphan_page");
  });

  it("ningún proyecto pasa del tope duro de páginas", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `/p${i}`);
    const site: Site = { "/robots.txt": "", "/sitemap.xml": sitemap(...paths), "/": html("/", [], org), ...Object.fromEntries(paths.map((p) => [p, html(p)])) };
    expect(HARD_MAX_PAGES).toBe(1000);
    const r = await harness(site).run({ limits: { maxPages: 5000 } });
    expect(r.pages.length).toBeLessThanOrEqual(HARD_MAX_PAGES);
  });

  it("el tiempo total corta el rastreo como parcial", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `/p${i}`);
    const site: Site = { "/robots.txt": "", "/sitemap.xml": sitemap(...paths), "/": html("/", [], org), ...Object.fromEntries(paths.map((p) => [p, html(p)])) };
    const r = await harness(site).run({ limits: { maxDurationMs: 5_000, pauseMs: 1_000 } });
    expect(r.outcome).toBe("partial");
    expect(r.truncatedBy).toBe("time");
    expect(r.pages.length).toBeLessThan(31);
    expect(r.detail).toContain("tiempo máximo");
  });
});

describe("cortesía", () => {
  it("nunca hay más peticiones a la vez que la concurrencia, y cada página va seguida de su pausa", async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/p${i}`);
    const site: Site = { "/robots.txt": "", "/sitemap.xml": sitemap(...paths), "/": html("/", [], org), ...Object.fromEntries(paths.map((p) => [p, html(p)])) };
    const h = harness(site);
    await h.run();
    expect(h.maxInFlight()).toBeLessThanOrEqual(DEFAULT_LIMITS.concurrency);
    expect(h.maxInFlight()).toBeGreaterThan(0);
    expect(h.sleeps.filter((ms) => ms === 400).length).toBeGreaterThanOrEqual(13);
  });

  it("respeta Crawl-delay: la pausa sube a lo que pide el sitio, con tope", async () => {
    const site = { ...healthy(), "/robots.txt": `User-agent: *\nCrawl-delay: 3\nSitemap: ${BASE}/sitemap.xml\n` };
    const h = harness(site);
    await h.run();
    expect(h.sleeps).toContain(3000);
    expect(h.sleeps.filter((ms) => ms === 400)).toHaveLength(0);
    const huge = harness({ ...healthy(), "/robots.txt": "User-agent: *\nCrawl-delay: 600\n" });
    await huge.run();
    expect(Math.max(...huge.sleeps)).toBe(5000);
  });

  it("pide como máximo 1 MB de HTML por página y acepta lo truncado", async () => {
    const big = html("/", [], org) + "<p>x</p>".repeat(200_000);
    const h = harness({ "/robots.txt": "", "/": big });
    const r = await h.run();
    const call = h.log.find((l) => l.url === `${BASE}/`)!;
    expect(call).toMatchObject({ maxBytes: 1_000_000, truncate: true });
    expect(r.pages[0]!.facts?.title).toBe(LONG_TITLE("/"));
  });
});

describe("robots.txt", () => {
  it("una URL prohibida no se descarga y se registra como bloqueada", async () => {
    const site = { ...healthy(), "/robots.txt": `User-agent: *\nDisallow: /b\nSitemap: ${BASE}/sitemap.xml\n` };
    const h = harness(site);
    const r = await h.run();
    expect(h.urls()).not.toContain(`${BASE}/b`);
    expect(r.pages.find((p) => p.path === "/b")).toMatchObject({ blockedByRobots: true, inSitemap: true, facts: null });
    expect(evaluate({ pages: r.pages, site: r.site, markets: [] }).map((i) => i.code)).toContain("sitemap_url_blocked");
  });

  it("si prohíbe todo, no se pide ninguna página", async () => {
    const h = harness({ ...healthy(), "/robots.txt": "User-agent: *\nDisallow: /\n" });
    const r = await h.run();
    expect(r.outcome).toBe("site_blocked");
    expect(r.pages).toEqual([]);
    expect(r.site.robots.blocksAll).toBe(true);
    expect(h.urls()).toEqual([`${BASE}/robots.txt`]);
  });

  it("sin robots.txt se rastrea todo", async () => {
    const site = healthy();
    delete site["/robots.txt"];
    const r = await harness(site).run();
    expect(r.outcome).toBe("complete");
    expect(r.site.robots.status).toBe(404);
  });

  it("un robots.txt que falla se informa como ilegible y el rastreo sigue", async () => {
    const r = await harness({ ...healthy(), "/robots.txt": { fail: true } }).run();
    expect(r.site.robots.status).toBe(0);
    expect(r.outcome).toBe("complete");
  });
});

describe("sitemaps", () => {
  it("lee un índice con sus hijos y descarta los de otro host", async () => {
    const site: Site = {
      "/robots.txt": "",
      "/sitemap.xml": `<sitemapindex><sitemap><loc>${BASE}/s1.xml</loc></sitemap><sitemap><loc>https://otro.test/s2.xml</loc></sitemap></sitemapindex>`,
      "/s1.xml": sitemap("/a", "https://otro.test/z"),
      "/": html("/", [], org),
      "/a": html("/a", ["/"]),
    };
    const h = harness(site);
    const r = await h.run();
    expect(r.site.sitemaps.map((s) => [s.url, s.kind])).toEqual([[`${BASE}/sitemap.xml`, "index"], [`${BASE}/s1.xml`, "urlset"]]);
    expect(r.pages.find((p) => p.path === "/a")?.inSitemap).toBe(true);
    expect(h.urls().some((u) => u.includes("otro.test"))).toBe(false);
  });

  it("usa el sitemap del proyecto y los que declare robots.txt; el que robots.txt no declara no cuenta como declarado", async () => {
    const site = { ...healthy(), "/robots.txt": "", "/custom.xml": sitemap("/", "/a", "/b") };
    const r = await harness(site).run({ sitemapUrl: `${BASE}/custom.xml` });
    expect(r.site.sitemaps).toEqual([{ url: `${BASE}/custom.xml`, status: 200, kind: "urlset" }]);
    expect(r.site.sitemapDeclaredInRobots).toBe(false);
  });

  it("un sitemap ausente o que no es XML queda registrado y el rastreo sigue desde la portada", async () => {
    const site = healthy();
    delete site["/sitemap.xml"];
    const missing = await harness(site).run();
    expect(missing.site.sitemaps).toEqual([{ url: `${BASE}/sitemap.xml`, status: 404, kind: "unknown" }]);
    expect(missing.pages.map((p) => p.path)).toEqual(["/", "/a", "/b"]);
    const wrong = await harness({ ...healthy(), "/sitemap.xml": "<html><body>Bienvenido</body></html>" }).run();
    expect(wrong.site.sitemaps[0]).toMatchObject({ status: 200, kind: "unknown" });
  });

  it("pone un tope al número de sitemaps hijos", async () => {
    const kids = Array.from({ length: 30 }, (_, i) => `<sitemap><loc>${BASE}/k${i}.xml</loc></sitemap>`).join("");
    const site: Site = { "/robots.txt": "", "/sitemap.xml": `<sitemapindex>${kids}</sitemapindex>`, "/": html("/", [], org) };
    const h = harness(site);
    await h.run();
    expect(h.urls().filter((u) => /\/k\d+\.xml$/.test(u))).toHaveLength(DEFAULT_LIMITS.maxChildSitemaps);
  });
});

describe("redirecciones", () => {
  const site = (): Site => ({
    "/robots.txt": "",
    "/sitemap.xml": sitemap("/", "/vieja", "/cadena", "/bucle-a", "/ext"),
    "/": html("/", [], org),
    "/vieja": { status: 301, location: "/nueva" },
    "/nueva": html("/nueva", ["/"]),
    "/cadena": { status: 301, location: "/c2" },
    "/c2": { status: 302, location: "/c3" },
    "/c3": { status: 301, location: "/nueva" },
    "/bucle-a": { status: 301, location: "/bucle-b" },
    "/bucle-b": { status: 301, location: "/bucle-a" },
    "/ext": { status: 301, location: "https://otro.test/" },
  });

  it("mide los saltos, registra el destino y rastrea el destino aparte", async () => {
    const r = await harness(site()).run();
    const by = (path: string) => r.pages.find((p) => p.path === path)!;
    expect(by("/vieja")).toMatchObject({ status: 200, hops: 1, finalPath: "/nueva", loop: false, facts: null });
    expect(by("/cadena")).toMatchObject({ hops: 3, finalPath: "/nueva" });
    expect(by("/nueva")).toMatchObject({ hops: 0, finalPath: null });
    expect(by("/nueva").facts?.title).toBe(LONG_TITLE("/nueva"));
  });

  it("una página redirigida no sale como título duplicado de su destino", async () => {
    const r = await harness(site()).run();
    const codes = evaluate({ pages: r.pages, site: r.site, markets: [] }).map((i) => i.code);
    expect(codes).not.toContain("title_duplicate");
    expect(codes).toContain("redirect_chain");
    expect(codes).toContain("sitemap_url_redirected");
  });

  it("detecta un bucle y no lo repite", async () => {
    const h = harness(site());
    const r = await h.run();
    expect(r.pages.find((p) => p.path === "/bucle-a")).toMatchObject({ loop: true, status: 0 });
    expect(h.urls().filter((u) => u.endsWith("/bucle-a")).length).toBeLessThanOrEqual(2);
    expect(evaluate({ pages: r.pages, site: r.site, markets: [] }).map((i) => i.code)).toContain("redirect_loop");
  });

  it("una cadena más larga que el límite se trata como bucle", async () => {
    const long: Site = { "/robots.txt": "", "/": html("/", ["/r0"], org) };
    for (let i = 0; i < 10; i++) long[`/r${i}`] = { status: 301, location: `/r${i + 1}` };
    const r = await harness(long).run();
    expect(r.pages.find((p) => p.path === "/r0")).toMatchObject({ loop: true });
  });

  it("no sigue una redirección que sale del sitio", async () => {
    const h = harness(site());
    const r = await h.run();
    expect(r.pages.find((p) => p.path === "/ext")).toMatchObject({ status: 301, finalPath: null });
    expect(h.urls().some((u) => u.includes("otro.test"))).toBe(false);
  });
});

describe("errores y respuestas raras", () => {
  it("registra los errores 404, 500 y las caídas de red como estado 0, y las reglas los ven", async () => {
    const site: Site = {
      "/robots.txt": "",
      "/": html("/", ["/roto", "/error", "/cae"], org),
      "/error": { status: 500 },
      "/cae": { fail: true },
    };
    const r = await harness(site).run();
    const by = (p: string) => r.pages.find((x) => x.path === p)!;
    expect(by("/roto").status).toBe(404);
    expect(by("/error").status).toBe(500);
    expect(by("/cae").status).toBe(0);
    const issues = evaluate({ pages: r.pages, site: r.site, markets: [] });
    expect(issues.filter((i) => i.code === "broken_link").map((i) => i.page)).toEqual(["/cae", "/error", "/roto"]);
  });

  it("lee X-Robots-Tag de la respuesta", async () => {
    const site: Site = { "/robots.txt": "", "/sitemap.xml": sitemap("/", "/a"), "/": html("/", [], org), "/a": { ...{ body: html("/a", ["/"]) }, xRobots: "noindex" } };
    const r = await harness(site).run();
    expect(r.pages.find((p) => p.path === "/a")?.xRobots).toEqual(["noindex"]);
  });

  it("http sin redirección a https, y no se comprueba si el sitio ya es http o si falla", async () => {
    expect((await harness({ ...healthy(), "http:/": { status: 200, body: "hola" } }).run()).site.httpRedirectsToHttps).toBe(false);
    expect((await harness({ ...healthy(), "http:/": { fail: true } }).run()).site.httpRedirectsToHttps).toBeNull();
    const plain = harness({ "/robots.txt": "", "/": html("/", [], org) });
    expect((await plain.run({ baseUrl: "http://acme.test" })).site.httpRedirectsToHttps).toBeNull();
  });
});

describe("cuando no se puede rastrear", () => {
  it("la portada pide sesión (401): se explica y no se rastrea nada más", async () => {
    const h = harness({ "/robots.txt": "", "/": { status: 401 }, "/a": html("/a") });
    const r = await h.run();
    expect(r.outcome).toBe("login_required");
    expect(r.detail).toContain("iniciar sesión");
    expect(r.pages).toEqual([]);
    expect(h.urls().some((u) => u.endsWith("/a"))).toBe(false);
  });

  it("la portada no responde", async () => {
    const r = await harness({ "/robots.txt": "", "/": { fail: true } }).run();
    expect(r.outcome).toBe("unreachable");
    expect(r.pages).toEqual([]);
  });

  it("un cortafuegos que rechaza la portada (403 o 429) se explica con el agente que hay que permitir", async () => {
    for (const status of [403, 429]) {
      const r = await harness({ "/robots.txt": "", "/": { status } }).run();
      expect(r.outcome).toBe("blocked_by_site");
      expect(r.detail).toContain("PageSpeedAOC-SEO");
      expect(r.pages).toEqual([]);
    }
  });

  it("si tras 20 peticiones el 30 % son 403 o 429, corta y no entrega páginas dudosas como errores", async () => {
    const paths = Array.from({ length: 60 }, (_, i) => `/p${i}`);
    const site: Site = { "/robots.txt": "", "/sitemap.xml": sitemap(...paths), "/": html("/", [], org), ...Object.fromEntries(paths.map((p, i) => [p, i % 2 === 0 ? { status: 403 } : html(p)])) };
    const h = harness(site);
    const r = await h.run();
    expect(r.outcome).toBe("blocked_by_site");
    expect(r.detail).toContain("cortafuegos");
    expect(h.log.length).toBeLessThan(40);
  });

  it("los 404 normales no se confunden con un bloqueo", async () => {
    const paths = Array.from({ length: 40 }, (_, i) => `/p${i}`);
    const site: Site = { "/robots.txt": "", "/sitemap.xml": sitemap(...paths), "/": html("/", [], org) };
    const r = await harness(site).run();
    expect(r.outcome).toBe("complete");
    expect(r.pages.filter((p) => p.status === 404)).toHaveLength(40);
  });
});

// ------------------------------------------------------------ servidor real

describe("con un servidor HTTP real", () => {
  let server: Server;
  let origin: string;
  const seen: Array<{ url: string; ua: string | undefined }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url ?? "", ua: req.headers["user-agent"] });
      const send = (status: number, type: string, body: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": type, ...headers });
        res.end(body);
      };
      const here = `http://${req.headers.host}`;
      if (req.url === "/robots.txt") return send(200, "text/plain", `User-agent: *\nSitemap: ${here}/sitemap.xml\n`);
      if (req.url === "/sitemap.xml") return send(200, "application/xml", `<urlset><url><loc>${here}/</loc></url><url><loc>${here}/a</loc></url></urlset>`);
      if (req.url === "/viejo") return send(301, "text/html", "", { location: "/a" });
      if (req.url === "/grande") return send(200, "text/html", "<html><head><title>Grande</title></head><body>" + "x".repeat(3_000_000));
      if (req.url === "/noindex") return send(200, "text/html", "<html><body>x</body></html>", { "x-robots-tag": "noindex" });
      if (req.url === "/") return send(200, "text/html", `<html lang="es"><head><title>Inicio</title></head><body><h1>Inicio</h1><a href="/a">a</a><a href="/viejo">v</a><p>${"hola ".repeat(30)}</p></body></html>`);
      if (req.url === "/a") return send(200, "text/html", `<html lang="es"><head><title>A</title></head><body><h1>A</h1><p>${"texto ".repeat(30)}</p></body></html>`);
      send(404, "text/html", "no");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("rastrea de punta a punta, identificándose con su agente de usuario", async () => {
    seen.length = 0;
    const r = await crawl({ baseUrl: origin, allowedHosts: ["127.0.0.1"], allowPrivate: true, limits: { pauseMs: 0 } });
    expect(r.outcome).toBe("complete");
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/a", "/viejo"]);
    expect(r.pages.find((p) => p.path === "/viejo")).toMatchObject({ hops: 1, finalPath: "/a" });
    expect(r.pages.find((p) => p.path === "/")?.facts?.title).toBe("Inicio");
    expect(r.site.sitemaps).toEqual([{ url: `${origin}/sitemap.xml`, status: 200, kind: "urlset" }]);
    expect(seen.length).toBeGreaterThan(3);
    expect(new Set(seen.map((s) => s.ua))).toEqual(new Set([SEO_USER_AGENT]));
  });

  it("sin permiso para direcciones privadas (lo normal) no se conecta a localhost", async () => {
    seen.length = 0;
    const r = await crawl({ baseUrl: origin, allowedHosts: ["127.0.0.1"], limits: { pauseMs: 0 } });
    expect(r.outcome).toBe("unreachable");
    expect(seen).toEqual([]);
  });

  it("un host fuera de la lista no se alcanza", async () => {
    seen.length = 0;
    const r = await crawl({ baseUrl: origin, allowedHosts: ["otro.test"], allowPrivate: true, limits: { pauseMs: 0 } });
    expect(r.outcome).toBe("unreachable");
    expect(seen).toEqual([]);
  });

  describe("fetchHop", () => {
    const opts = { allowedHosts: ["127.0.0.1"], allowPrivate: true };

    it("no sigue redirecciones y devuelve el destino sin leer el cuerpo", async () => {
      const hop: HopResponse = await fetchHop(`${origin}/viejo`, opts);
      expect(hop).toMatchObject({ status: 301, location: "/a", text: "", truncated: false });
    });

    it("entrega las cabeceras que importan", async () => {
      const hop = await fetchHop(`${origin}/noindex`, opts);
      expect(hop).toMatchObject({ status: 200, xRobotsTag: "noindex" });
      expect(hop.contentType).toContain("text/html");
    });

    it("con truncate entrega lo leído hasta el tope; sin truncate falla", async () => {
      const cut = await fetchHop(`${origin}/grande`, { ...opts, maxBytes: 1000, truncate: true });
      expect(cut.truncated).toBe(true);
      expect(cut.text.length).toBe(1000);
      expect(cut.text).toContain("<title>Grande</title>");
      await expect(fetchHop(`${origin}/grande`, { ...opts, maxBytes: 1000 })).rejects.toThrow(/demasiado grande/);
    });

    it("rechaza hosts fuera de la lista y direcciones privadas", async () => {
      await expect(fetchHop(`${origin}/a`, { allowedHosts: ["otro.test"], allowPrivate: true })).rejects.toThrow(/no está en los hosts permitidos/);
      await expect(fetchHop(`${origin}/a`, { allowedHosts: ["127.0.0.1"] })).rejects.toThrow(/privadas/);
    });
  });
});
