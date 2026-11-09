import { describe, expect, it } from "vitest";
import { parseMarkets } from "../../scripts/spike-seo/lib/lang";
import { buildFindings, buildReport, findingType, missingInputs, type ReportInputs } from "../../scripts/spike-seo/lib/report";
import {
  assertNoLeaks,
  FICTIONAL_CF_ZONE,
  FICTIONAL_GA4_PROPERTY,
  FIXTURE_NAMES,
  findLeaks,
  knownFromConfig,
  perturbCount,
  pseudoRoute,
  pseudoUrl,
  sanitizeAll,
  sanitizeDataset,
  type FixtureName,
} from "../../scripts/spike-seo/lib/sanitize";

// Todo son datos inventados para la prueba: ningún dato real.
const HOST = "www.zapateria-luna.test";
const markets = parseMarkets("es=/es,en=/en");
const CF_ZONE = "abcdef0123456789abcdef0123456789";
const GA4_PROPERTY = "987654321";

const calls = (extra: Record<string, number> = {}) => [
  { label: "oauth-token", calls: 1, totalMs: 120, statuses: { "200": 1 } },
  { label: "gsc-search", calls: 3, totalMs: 4500, statuses: { "200": 3, ...extra } },
];

function fullInputs(): ReportInputs {
  return {
    generatedAt: "2026-11-09T10:00:00.000Z",
    markets,
    gscSummary: {
      range: { startDate: "2026-10-01", endDate: "2026-10-28" },
      dataState: "final",
      rows: 2800,
      requests: 1,
      truncated: false,
      totals: { clicks: 1000, impressions: 40_000 },
      pages: 100,
      countries: 20,
      lastDateWithData: "2026-10-28",
      delayDays: 3,
      languages: {
        byLang: {
          es: { pages: 110, clicks: 700, impressions: 28_500, viaDefault: 0 },
          en: { pages: 30, clicks: 260, impressions: 10_000, viaDefault: 0 },
        },
        unmatchedCount: 7,
        unmatchedTop: [
          { page: "/blog/uno", clicks: 20, impressions: 900 },
          { page: "/blog/dos", clicks: 10, impressions: 500 },
          { page: "/blog/tres", clicks: 5, impressions: 300 },
          { page: "/blog/cuatro", clicks: 3, impressions: 200 },
          { page: "/blog/cinco", clicks: 2, impressions: 100 },
          { page: "/blog/seis", clicks: 1, impressions: 50 },
          { page: "/blog/siete", clicks: 1, impressions: 20 },
        ],
      },
      queryRows: 900,
      sitemaps: 2,
      inspected: 5,
      calls: calls(),
    },
    ga4Summary: {
      range: { startDate: "2026-10-01", endDate: "2026-10-28" },
      rows: 5600,
      requests: 1,
      truncated: false,
      sessions: 5000,
      aiSessionsServerFilter: 50,
      aiSessionsLocalRegex: 50,
      directSessions: 1000,
      aiSources: { "chatgpt.com": 40, "perplexity.ai": 10 },
      pages: 120,
      pagesWithoutLanguage: 4,
      calls: [{ label: "ga4-report", calls: 2, totalMs: 2000, statuses: { "200": 2 } }],
    },
    ga4Ai: [{ dims: { date: "20261001" }, metrics: { sessions: 3 } }],
    cfSummary: {
      range: { startDate: "2026-10-22", endDate: "2026-10-28" },
      perDay: Array.from({ length: 7 }, (_, i) => ({ día: `2026-10-${22 + i}`, estado: "ok", solicitudes: 100 })),
      byBot: { GPTBot: { requests: 500, bytes: 10_000 }, ClaudeBot: { requests: 150, bytes: 3000 }, otro: { requests: 50, bytes: 500 } },
      pathsSample: [{ count: 3, dimensions: { clientRequestPath: "/x", userAgent: "GPTBot" } }],
      referralsSample: { error: "plan sin acceso" },
      calls: [{ label: "cf-paths", calls: 1, totalMs: 300, statuses: { "200": 1 } }],
    },
    compare: {
      totals: { gscClicks: 1000, gscImpressions: 40_000, ga4Sessions: 5000, ga4Users: 4000 },
      coverage: { gscPages: 100, ga4Pages: 120, inBoth: 95, onlyGsc: 5, onlyGa4: 25, gscClicksShareInGa4: 0.97, ga4SessionsShareInGsc: 0.6 },
    },
    probeSummary: [
      { provider: "openai", lang: "es", prompt: "¿Qué zapatería recomiendas?", runs: 3, mentionRate: 1, citedRate: 0 },
      { provider: "openai", lang: "en", prompt: "Best shoe shop?", runs: 3, mentionRate: 2 / 3, citedRate: 0 },
    ],
    crawlSummary: {
      sitemapUrls: 200,
      crawled: 20,
      failures: [],
      findings: [
        { url: "https://x.test/a", hallazgo: "sin <title>" },
        { url: "https://x.test/a", hallazgo: "sin canónica" },
        { url: "https://x.test/b", hallazgo: "3 etiquetas h1" },
        { url: "https://x.test/c", hallazgo: "2 etiquetas h1" },
      ],
      avgMs: 350,
    },
    crawlPages: [{ url: "https://x.test/a", status: 200, ms: 300 }],
    gscSearch: [{ keys: { date: "2026-10-01" }, clicks: 1, impressions: 2, ctr: 0.5, position: 3 }],
  };
}

describe("informe de hallazgos", () => {
  it("con todos los datos responde las 11 preguntas, deja notas vacías y la lista go / no-go", () => {
    const md = buildReport(fullInputs());
    for (let n = 1; n <= 11; n++) expect(md).toMatch(new RegExp(`^## ${n}\\. `, "m"));
    expect(md.match(/\*\*Notas:\*\*/g)).toHaveLength(12);
    expect(md.match(/\*\*Veredicto propuesto: /g)).toHaveLength(11);
    expect(md).toContain("Generado: 2026-11-09.");

    // Evidencia numérica sacada de los JSON.
    expect(md).toContain("1.000"); // clics
    expect(md).toContain("40.000"); // impresiones
    expect(md).toContain("140 de 147 (95,2 %)"); // páginas con idioma
    expect(md).toContain("97,0 %"); // cobertura del cruce
    expect(md).toContain("1,00 %"); // IA sobre sesiones: 50 / 5000
    expect(md).toContain("GPTBot");

    // Casillas de la decisión final (todas sin marcar).
    const goNoGo = md.slice(md.indexOf("## Decisión go / no-go"));
    expect(goNoGo.match(/^- \[ \] /gm)).toHaveLength(6);
    expect(goNoGo).not.toMatch(/\[x\]/i);
    for (const topic of ["Cuenta de servicio", "GSC y GA4 bastan", "Fuente de bots", "Idioma por prefijo", "Sondeo de IA", "Dimensionamiento y retención"]) expect(goNoGo).toContain(topic);
    expect(missingInputs(fullInputs()).map((m) => m.file)).toEqual(["gsc-queries.json", "ga4-report.json", "probe-runs.json"]);
  });

  it("propone veredictos según los umbrales", () => {
    const v = Object.fromEntries(buildFindings(fullInputs()).map((f) => [f.n, f.verdict]));
    expect(v[1]).toBe("revisar a mano");
    expect(v[2]).toBe("revisar a mano");
    expect(v[3]).toBe("cumple");
    expect(v[4]).toBe("cumple");
    expect(v[5]).toBe("cumple");
    expect(v[6]).toBe("cumple");
    expect(v[7]).toBe("cumple");
    expect(v[8]).toBe("revisar a mano");
    expect(v[9]).toBe("revisar a mano"); // 1 de 2 preguntas varía: entre el 25 % y el 50 %
    expect(v[10]).toBe("cumple");
    expect(v[11]).toBe("cumple");
  });

  it("con datos faltantes no falla y dice qué script correr", () => {
    const md = buildReport({});
    for (let n = 1; n <= 11; n++) expect(md).toMatch(new RegExp(`^## ${n}\\. `, "m"));
    for (const script of ["10-gsc.ts", "20-ga4.ts", "30-cloudflare.ts", "40-crawl.ts", "50-probe.ts", "60-compare.ts"]) expect(md).toContain(`sin datos: corre ${script}`);
    expect(md).toContain("Faltan 12 archivo(s)");
    const verdicts = buildFindings({}).map((f) => f.verdict);
    expect(verdicts.every((x) => x === "revisar a mano")).toBe(true);
  });

  it("con solo una parte de los archivos usa lo que hay", () => {
    const i = fullInputs();
    const md = buildReport({ gscSummary: i.gscSummary, compare: i.compare });
    expect(md).toContain("140 de 147 (95,2 %)");
    expect(md).toContain("sin datos: corre 20-ga4.ts");
    expect(md).toContain("sin datos: corre 30-cloudflare.ts");
  });

  it("marca los casos malos: idioma, cuota, IA en cero, historial de Cloudflare, mock y truncado", () => {
    const i = fullInputs();
    const bad: ReportInputs = {
      ...i,
      gscSummary: {
        ...i.gscSummary,
        delayDays: 9,
        truncated: true,
        languages: { byLang: { es: { pages: 10, clicks: 100, impressions: 1000, viaDefault: 0 } }, unmatchedCount: 90, unmatchedTop: [] },
        calls: calls({ "429": 2 }),
      },
      ga4Summary: { ...i.ga4Summary, aiSessionsServerFilter: 0, aiSessionsLocalRegex: 0, aiSources: {} },
      cfSummary: { ...i.cfSummary, perDay: [{ día: "2026-10-27", estado: "ok", solicitudes: 5 }, { día: "2026-10-26", estado: "FORBIDDEN", solicitudes: 0 }] },
      compare: { ...i.compare, coverage: { ...i.compare!.coverage!, gscClicksShareInGa4: 0.5 } },
      probeSummary: [{ provider: "mock", lang: "es", prompt: "p", runs: 3, mentionRate: 0, citedRate: 0 }],
      crawlSummary: { crawled: 0, findings: [], failures: [] },
    };
    const v = Object.fromEntries(buildFindings(bad).map((f) => [f.n, f.verdict]));
    expect(v[3]).toBe("no cumple");
    expect(v[4]).toBe("no cumple");
    expect(v[5]).toBe("no cumple"); // retraso de 9 días
    expect(v[6]).toBe("no cumple");
    expect(v[7]).toBe("revisar a mano");
    expect(v[9]).toBe("revisar a mano");
    expect(v[10]).toBe("no cumple");
    expect(v[11]).toBe("revisar a mano");
    const md = buildReport(bad);
    expect(md).toContain("Días con error (historial del plan)");
    expect(md).toContain("FORBIDDEN ×1");
    expect(md).toContain("Respuestas 429 (cuota)");
  });

  it("solo lleva agregados: a lo sumo 5 rutas, sin consultas ni identificadores", () => {
    const i = fullInputs();
    const withQueries: ReportInputs = {
      ...i,
      gscQueries: [{ keys: { page: `https://${HOST}/es/a`, query: "comprar zapatos rojos" }, clicks: 3, impressions: 9, ctr: 0.3, position: 2 }],
      gscSearch: [{ keys: { date: "2026-10-01", page: `https://${HOST}/es/precios` }, clicks: 1, impressions: 2, ctr: 0.5, position: 3 }],
    };
    const md = buildReport(withQueries);
    expect(md).not.toContain("comprar zapatos");
    expect(md).not.toContain(HOST);
    expect(md).toContain("/blog/cinco");
    expect(md).not.toContain("/blog/seis");
    expect(md).toContain("(y 2 más)");
  });

  it("agrupa los hallazgos del rastreo por tipo", () => {
    expect(findingType("3 etiquetas h1")).toBe("h1 distinto de uno");
    expect(findingType("0 etiquetas h1")).toBe("h1 distinto de uno");
    expect(findingType('lang="en" no coincide con el idioma de la ruta (es)')).toBe("lang no coincide con el idioma de la ruta");
    expect(findingType("hreflang: https://x.test/en no devuelve el enlace (falta reciprocidad)")).toBe("hreflang: falta reciprocidad");
    expect(findingType("sin <title>")).toBe("sin <title>");
    expect(buildReport(fullInputs())).toContain("| h1 distinto de uno | 2 |");
  });
});

// ---------- saneado ----------

const SECRET_WORDS = ["zapateria-luna", "zapatos-rojos", "comprar zapatos", "mujer", "ofertas", "Zapatería Luna", "campana-verano"];

function originals(): Record<FixtureName, unknown> {
  return {
    "gsc-search": [
      { keys: { date: "2026-10-01", page: `https://${HOST}/es/mujer/zapatos-rojos?utm=campana-verano`, country: "esp", device: "MOBILE" }, clicks: 123, impressions: 4567, ctr: 123 / 4567, position: 7.34567 },
      { keys: { date: "2026-10-02", page: `https://${HOST}/en/women/ofertas/`, country: "usa", device: "DESKTOP" }, clicks: 0, impressions: 12, ctr: 0, position: 11.04 },
      { keys: { date: "2026-10-02", page: `https://${HOST}/`, country: "usa", device: "DESKTOP" }, clicks: 5, impressions: 80, ctr: 0.0625, position: 3.2 },
    ],
    "gsc-queries": [
      { keys: { page: `https://${HOST}/es/mujer/zapatos-rojos`, query: "comprar zapatos rojos" }, clicks: 40, impressions: 900, ctr: 40 / 900, position: 4.5 },
      { keys: { page: `https://${HOST}/es/mujer/zapatos-rojos`, query: "zapatería luna ofertas" }, clicks: 7, impressions: 90, ctr: 7 / 90, position: 6.1 },
    ],
    "gsc-inspection": [
      {
        url: `https://${HOST}/es/mujer/zapatos-rojos`,
        result: {
          inspectionResultLink: `https://search.google.com/search-console/inspect?resource_id=sc-domain%3A${HOST}`,
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Submitted and indexed",
            lastCrawlTime: "2026-10-20T08:00:00Z",
            googleCanonical: `https://${HOST}/es/mujer/zapatos-rojos`,
            sitemap: [`https://${HOST}/sitemap.xml`],
            referringUrls: [`https://${HOST}/es/ofertas`],
          },
          richResultsResult: { verdict: "PASS", detectedItems: [{ richResultType: "Breadcrumbs", items: [{ name: "Migas de Zapatería Luna", issues: [{ issueMessage: "Falta el campo campana-verano", severity: "WARNING" }] }] }] },
        },
      },
      { url: `https://${HOST}/en/women/ofertas`, error: `gsc-inspect: HTTP 403. Sin permiso sobre sc-domain:${HOST}` },
    ],
    "gsc-sitemaps": [{ path: `https://${HOST}/sitemap.xml`, lastSubmitted: "2026-09-01T00:00:00Z", isPending: false, errors: "0", warnings: "3", contents: [{ type: "web", submitted: "250", indexed: "231" }] }],
    "ga4-report": [
      { dims: { date: "20261001", pagePath: "/es/mujer/zapatos-rojos?x=1", country: "Spain", language: "es-es", sessionSource: "google", sessionMedium: "organic" }, metrics: { sessions: 321, totalUsers: 300 } },
      { dims: { date: "20261001", pagePath: "/en/women/ofertas", country: "United States", language: "en-us", sessionSource: "boletin-luna", sessionMedium: "email-interno" }, metrics: { sessions: 9, totalUsers: 9 } },
      { dims: { date: "20261002", pagePath: "/", country: "Spain", language: "es-es", sessionSource: "(direct)", sessionMedium: "(none)" }, metrics: { sessions: 1500, totalUsers: 1200 } },
    ],
    "ga4-ai": [{ dims: { date: "20261001", sessionSource: "chatgpt.com", sessionMedium: "referral", pagePath: "/es/mujer/zapatos-rojos" }, metrics: { sessions: 4, totalUsers: 4 } }],
    "cf-summary": {
      zone: CF_ZONE,
      range: { startDate: "2026-10-22", endDate: "2026-10-28" },
      perDay: [
        { día: "2026-10-27", estado: "ok", solicitudes: 742 },
        { día: "2026-10-26", estado: "FORBIDDEN", solicitudes: 0 },
      ],
      byBot: { GPTBot: { requests: 700, bytes: 5_123_456 }, otro: { requests: 42, bytes: 9000 } },
      pathsSample: [{ count: 55, dimensions: { clientRequestPath: "/es/mujer/zapatos-rojos", userAgent: "Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)" } }],
      referralsSample: [{ count: 8, dimensions: { clientRefererHost: "chatgpt.com" } }, { count: 2, dimensions: { clientRefererHost: "foro.competidor-luna.test" } }],
      calls: [{ label: "cf-paths", calls: 1, totalMs: 300, statuses: { "200": 1 } }],
    },
    "crawl-pages": [
      {
        url: `https://${HOST}/es/mujer/zapatos-rojos`,
        title: "Zapatos rojos | Zapatería Luna",
        description: "Compra zapatos rojos en la mejor zapatería",
        canonical: `https://${HOST}/es/mujer/zapatos-rojos`,
        htmlLang: "es",
        robots: "index, follow",
        h1Count: 1,
        hreflang: [
          { lang: "es", href: `https://${HOST}/es/mujer/zapatos-rojos` },
          { lang: "en", href: `https://${HOST}/en/women/red-shoes` },
        ],
        jsonLdTypes: ["Organization", "WebSite"],
        jsonLdErrors: 0,
        status: 200,
        ms: 312,
        lang: "es",
      },
      { url: `https://${HOST}/en/women/ofertas`, title: null, description: null, canonical: null, htmlLang: null, robots: null, h1Count: 0, hreflang: [], jsonLdTypes: [], jsonLdErrors: 1, status: 200, ms: 280, lang: "en" },
    ],
    "probe-runs": [
      { provider: "openai", lang: "es", prompt: "¿Qué zapatería de Madrid recomiendas?", repeat: 1, at: "2026-11-01T10:00:00.000Z", mentioned: true, cited: true, citedUrls: [`https://${HOST}/es/ofertas`], otherDomains: ["a-opinion.test", "z-guia.test"], excerpt: "Zapatería Luna es una buena opción" },
      { provider: "openai", lang: "es", prompt: "¿Qué zapatería de Madrid recomiendas?", repeat: 2, at: "2026-11-01T10:01:00.000Z", mentioned: false, cited: false, citedUrls: [], otherDomains: [], excerpt: "No lo sé" },
    ],
  };
}

const opts = { markets, ga4Property: GA4_PROPERTY, cfZone: CF_ZONE, known: [HOST, "zapateria-luna.test", GA4_PROPERTY, CF_ZONE] };

/** Forma de un JSON: claves y tipos, sin valores. */
function shapeOf(v: unknown): unknown {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.map(shapeOf);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shapeOf(x)]));
  return typeof v;
}

describe("seudonimización", () => {
  it("sustituye el host y cada segmento por tokens estables y conserva el prefijo de idioma", () => {
    const a = pseudoUrl(`https://${HOST}/es/mujer/zapatos-rojos?utm=abc#top`, markets);
    expect(a).toMatch(/^https:\/\/example\.com\/es\/p-[0-9a-f]{6}\/p-[0-9a-f]{6}\?x=[0-9a-f]{6}#f-[0-9a-f]{6}$/);
    expect(pseudoUrl(`https://${HOST}/es/mujer/zapatos-rojos`, markets)).toBe(pseudoUrl(`http://OTRO.test/es/mujer/zapatos-rojos`, markets)?.replace("http:", "https:"));
    expect(pseudoRoute("/en", markets)).toBe("/en");
    expect(pseudoRoute("/en/", markets)).toBe("/en/");
    expect(pseudoRoute("/", markets)).toBe("/");
    // /espanol no es el prefijo /es.
    expect(pseudoRoute("/espanol/x", markets)).toMatch(/^\/p-[0-9a-f]{6}\/p-[0-9a-f]{6}$/);
    // Sin prefijos configurados, /es también se seudonimiza.
    expect(pseudoRoute("/es/x", [])).toMatch(/^\/p-[0-9a-f]{6}\/p-[0-9a-f]{6}$/);
    expect(pseudoUrl("no es una url", markets)).toBeNull();
  });

  it("da el mismo token con la ruta codificada (GSC) y decodificada (GA4)", () => {
    expect(pseudoRoute("/es/caf%C3%A9", markets)).toBe(pseudoRoute("/es/café", markets));
  });

  it("perturba las cifras sin cambiar su orden de magnitud y de forma determinista", () => {
    expect(perturbCount(0, "k")).toBe(0);
    for (const n of [1, 7, 9, 10, 99, 100, 999, 1000, 54_321, 1_234_567]) {
      for (const key of ["a", "b", "c", "d", "e"]) {
        const out = perturbCount(n, key);
        expect(Math.floor(Math.log10(out))).toBe(Math.floor(Math.log10(n)));
        expect(out).toBe(perturbCount(n, key));
      }
    }
    const spread = new Set(["a", "b", "c", "d", "e", "f"].map((k) => perturbCount(5000, k)));
    expect(spread.size).toBeGreaterThan(1);
  });
});

describe("saneado de fixtures", () => {
  it("es determinista: misma entrada y misma sal, misma salida; otra sal, otros tokens", () => {
    const input = originals();
    for (const name of FIXTURE_NAMES) {
      const a = sanitizeDataset(name, input[name], opts);
      const b = sanitizeDataset(name, structuredClone(input[name]), opts);
      expect(b).toEqual(a);
    }
    const one = JSON.stringify(sanitizeDataset("gsc-queries", input["gsc-queries"], opts));
    const two = JSON.stringify(sanitizeDataset("gsc-queries", input["gsc-queries"], { ...opts, salt: "otra-sal" }));
    expect(two).not.toBe(one);
  });

  it("no deja fugas del original en ningún archivo", () => {
    const input = originals();
    const out = sanitizeAll(input, opts);
    expect(Object.keys(out).sort()).toEqual([...FIXTURE_NAMES].sort());
    for (const name of FIXTURE_NAMES) {
      const text = JSON.stringify(out[name]).toLowerCase();
      for (const word of SECRET_WORDS) expect(text, `${name} contiene "${word}"`).not.toContain(word.toLowerCase());
      expect(text).not.toContain(HOST);
      expect(text).not.toContain(GA4_PROPERTY);
      expect(text).not.toContain(CF_ZONE);
      expect(findLeaks(input[name], out[name], opts)).toEqual([]);
      assertNoLeaks(input[name], out[name], opts);
    }
  });

  it("conserva la forma de cada JSON", () => {
    const input = originals();
    const out = sanitizeAll(input, opts);
    for (const name of FIXTURE_NAMES) expect(shapeOf(out[name]), name).toEqual(shapeOf(input[name]));
  });

  it("conserva el prefijo de idioma y el cruce entre GSC y GA4", () => {
    const out = sanitizeAll(originals(), opts);
    const gsc = out["gsc-search"] as Array<{ keys: { page: string } }>;
    const ga4 = out["ga4-report"] as Array<{ dims: { pagePath: string } }>;
    expect(gsc[0]?.keys.page).toMatch(/^https:\/\/example\.com\/es\/p-/);
    expect(gsc[1]?.keys.page).toMatch(/^https:\/\/example\.com\/en\/p-[0-9a-f]{6}\/p-[0-9a-f]{6}\/$/);
    expect(gsc[2]?.keys.page).toBe("https://example.com/");
    expect(ga4[0]?.dims.pagePath).toMatch(/^\/es\/p-[0-9a-f]{6}\/p-[0-9a-f]{6}\?x=/);
    expect(ga4[2]?.dims.pagePath).toBe("/");
    // La misma página sale con la misma ruta en ambas fuentes.
    const pathOf = (u: string) => new URL(u).pathname;
    const inQueries = (out["gsc-queries"] as Array<{ keys: { page: string } }>)[0]?.keys.page ?? "";
    expect(pathOf(inQueries)).toBe(pathOf(gsc[0]?.keys.page ?? "").replace(/\?.*$/, ""));
    const gaClean = (ga4[0]?.dims.pagePath ?? "").replace(/\?.*$/, "");
    expect(gaClean).toBe(pathOf(inQueries));
  });

  it("numera las consultas, mantiene la coherencia de las cifras y los datos técnicos", () => {
    const out = sanitizeAll(originals(), opts);
    const q = out["gsc-queries"] as Array<{ keys: { query: string }; clicks: number; impressions: number; ctr: number }>;
    expect(q.map((r) => r.keys.query).sort()).toEqual(["consulta-1", "consulta-2"]);
    for (const r of out["gsc-search"] as Array<{ clicks: number; impressions: number; ctr: number; position: number; keys: Record<string, string> }>) {
      expect(r.clicks).toBeLessThanOrEqual(r.impressions);
      expect(r.ctr).toBeCloseTo(r.impressions ? r.clicks / r.impressions : 0, 3);
      expect(r.keys.country).toMatch(/^[a-z]{3}$/);
    }
    const search = out["gsc-search"] as Array<{ clicks: number; impressions: number; position: number }>;
    expect(search[1]?.clicks).toBe(0); // un cero sigue siendo cero
    expect(search[0]?.position).toBe(7.3);
    expect(Math.floor(Math.log10(search[0]?.impressions ?? 0))).toBe(3);
    expect(search[0]?.impressions).not.toBe(4567);

    const ga = out["ga4-report"] as Array<{ dims: Record<string, string>; metrics: { sessions: number; totalUsers: number } }>;
    expect(ga[0]?.dims).toMatchObject({ sessionSource: "google", sessionMedium: "organic", language: "es-es" });
    expect(ga[1]?.dims.sessionSource).toMatch(/^fuente-[0-9a-f]{6}$/);
    expect(ga[1]?.dims.sessionMedium).toMatch(/^medio-[0-9a-f]{6}$/);
    expect(ga[2]?.dims.sessionSource).toBe("(direct)");
    for (const r of ga) expect(r.metrics.totalUsers).toBeLessThanOrEqual(r.metrics.sessions);
    expect((out["ga4-ai"] as Array<{ dims: Record<string, string> }>)[0]?.dims.sessionSource).toBe("chatgpt.com");
  });

  it("sustituye zona, propiedad, textos del rastreo y del sondeo, y reordena los dominios", () => {
    const out = sanitizeAll(originals(), opts);
    const cf = out["cf-summary"] as { zone: string; perDay: Array<{ estado: string; solicitudes: number }>; byBot: Record<string, { requests: number }>; referralsSample: Array<{ dimensions: { clientRefererHost: string } }>; pathsSample: Array<{ dimensions: { userAgent: string; clientRequestPath: string } }> };
    expect(cf.zone).toBe(FICTIONAL_CF_ZONE);
    expect(cf.perDay.map((d) => d.estado)).toEqual(["ok", "FORBIDDEN"]);
    expect(cf.perDay[1]?.solicitudes).toBe(0);
    expect(Object.keys(cf.byBot)).toEqual(["GPTBot", "otro"]);
    expect(cf.referralsSample[0]?.dimensions.clientRefererHost).toBe("chatgpt.com");
    expect(cf.referralsSample[1]?.dimensions.clientRefererHost).toMatch(/^d-[0-9a-f]{6}\.example\.net$/);
    expect(cf.pathsSample[0]?.dimensions.userAgent).toContain("GPTBot");
    expect(cf.pathsSample[0]?.dimensions.clientRequestPath).toMatch(/^\/es\/p-[0-9a-f]{6}\/p-[0-9a-f]{6}$/);

    const crawl = out["crawl-pages"] as Array<{ title: string | null; htmlLang: string | null; hreflang: Array<{ lang: string; href: string }>; jsonLdTypes: string[]; canonical: string | null; robots: string | null }>;
    expect(crawl[0]?.title).toMatch(/^texto-[0-9a-f]{6}$/);
    expect(crawl[0]?.htmlLang).toBe("es");
    expect(crawl[0]?.robots).toBe("index, follow");
    expect(crawl[0]?.jsonLdTypes).toEqual(["Organization", "WebSite"]);
    expect(crawl[0]?.hreflang.map((h) => h.lang)).toEqual(["es", "en"]);
    expect(crawl[0]?.hreflang[1]?.href).toMatch(/^https:\/\/example\.com\/en\/p-/);
    expect(crawl[1]?.title).toBeNull();

    const probe = out["probe-runs"] as Array<{ prompt: string; repeat: number; mentioned: boolean; citedUrls: string[]; otherDomains: string[]; excerpt: string }>;
    expect(probe[0]?.prompt).toBe("pregunta-1");
    expect(probe[1]?.prompt).toBe("pregunta-1");
    expect(probe[0]?.mentioned).toBe(true);
    expect(probe[0]?.citedUrls[0]).toMatch(/^https:\/\/example\.com\/es\/p-/);
    expect(probe[0]?.otherDomains).toEqual([...(probe[0]?.otherDomains ?? [])].sort());
    expect(probe[0]?.otherDomains.every((d) => d.endsWith(".example.net"))).toBe(true);
    expect(probe[0]?.excerpt).toMatch(/^texto-/);

    const sitemaps = out["gsc-sitemaps"] as Array<{ path: string; errors: string; contents: Array<{ submitted: string }> }>;
    expect(sitemaps[0]?.path).toMatch(/^https:\/\/example\.com\/p-/);
    expect(typeof sitemaps[0]?.contents[0]?.submitted).toBe("string");
    expect(Number(sitemaps[0]?.contents[0]?.submitted)).toBeGreaterThanOrEqual(100);
    expect(sitemaps[0]?.errors).toBe("0");

    const insp = out["gsc-inspection"] as Array<{ url: string; result?: { indexStatusResult: { coverageState: string; verdict: string; lastCrawlTime: string } }; error?: string }>;
    expect(insp[0]?.result?.indexStatusResult).toMatchObject({ verdict: "PASS", coverageState: "Submitted and indexed", lastCrawlTime: "2026-10-20T08:00:00Z" });
    expect(insp[1]?.error).toMatch(/^texto-/);
  });

  it("reemplaza el ID de GA4 y la zona de Cloudflare donde aparezcan como valor", () => {
    const out = sanitizeDataset("cf-summary", { zone: "otra", extra: { ref: CF_ZONE, prop: GA4_PROPERTY } }, opts) as { zone: string; extra: { ref: string; prop: string } };
    expect(out.zone).toBe(FICTIONAL_CF_ZONE);
    expect(out.extra.ref).toBe(FICTIONAL_CF_ZONE);
    expect(out.extra.prop).toBe(FICTIONAL_GA4_PROPERTY);
  });

  it("assertNoLeaks falla si queda un host, una ruta, una consulta o un texto", () => {
    const input = originals();
    const clean = sanitizeDataset("gsc-queries", input["gsc-queries"], opts) as Array<{ keys: Record<string, string> }>;

    const withQuery = structuredClone(clean);
    (withQuery[0] as { keys: Record<string, string> }).keys.query = "Comprar Zapatos Rojos";
    expect(() => assertNoLeaks(input["gsc-queries"], withQuery, opts)).toThrow(/texto/);

    const withPath = structuredClone(clean);
    (withPath[0] as { keys: Record<string, string> }).keys.page = "https://example.com/es/mujer/p-abcdef";
    expect(() => assertNoLeaks(input["gsc-queries"], withPath, opts)).toThrow(/ruta/);

    const withHost = structuredClone(clean);
    (withHost[0] as { keys: Record<string, string> }).keys.page = `https://${HOST}/es/p-abcdef`;
    expect(() => assertNoLeaks(input["gsc-queries"], withHost, opts)).toThrow(/host/);

    // El mensaje no repite el dato completo.
    try {
      assertNoLeaks(input["gsc-queries"], withQuery, opts);
    } catch (err) {
      expect(String(err)).not.toContain("comprar zapatos rojos");
    }

    expect(() => assertNoLeaks(input["gsc-search"], input["gsc-search"], opts)).toThrow();
    expect(() => assertNoLeaks({ a: `ID ${GA4_PROPERTY}` }, { b: 1, c: GA4_PROPERTY }, opts)).toThrow(/identificador/);
  });

  it("un host real corto que cabe dentro de los valores ficticios no es una fuga", () => {
    // `e.com` está dentro de `example.com` y `ample.com` también: los marcadores propios no cuentan.
    const original = [{ keys: { page: "https://e.com/es/precios" } }, { keys: { page: "https://ample.com/es/x" } }];
    const clean = [{ keys: { page: "https://example.com/es/p-1a2b3c" } }, { keys: { page: "https://d-1a2b3c.example.net/es/p-4d5e6f" } }];
    expect(() => assertNoLeaks(original, clean, { markets: opts.markets, known: ["e.com", "ample.com"] })).not.toThrow();
    // Sigue detectando una fuga real del mismo host.
    expect(() => assertNoLeaks(original, [{ keys: { page: "https://e.com/es/p-1a2b3c" } }], { markets: opts.markets })).toThrow(/host/);
  });

  it("sanitizeAll no devuelve nada si un archivo deja una fuga (así 80-sanitize no escribe)", () => {
    const input = originals();
    // El agente de usuario se conserva a propósito; si trae el host del cliente, la comprobación lo detecta.
    (input["cf-summary"] as { pathsSample: Array<{ dimensions: { userAgent: string } }> }).pathsSample[0]!.dimensions.userAgent = `Mozilla/5.0 GPTBot (+https://${HOST}/bot)`;
    expect(() => sanitizeAll(input, opts)).toThrow(/cf-summary/);
  });

  it("omite los archivos ausentes y rechaza formas inesperadas", () => {
    const out = sanitizeAll({ "gsc-queries": originals()["gsc-queries"] }, opts);
    expect(Object.keys(out)).toEqual(["gsc-queries"]);
    expect(() => sanitizeDataset("gsc-search", { no: "es lista" }, opts)).toThrow(/lista/);
  });

  it("deduce los hosts e identificadores a vigilar desde la configuración", () => {
    expect(knownFromConfig({ gscSite: "sc-domain:zapateria-luna.test", siteUrl: `https://${HOST}`, ga4Property: GA4_PROPERTY, cfZone: CF_ZONE })).toEqual(["zapateria-luna.test", "zapateria-luna.test", GA4_PROPERTY, CF_ZONE]);
    expect(knownFromConfig({ gscSite: `https://${HOST}/` })).toEqual(["zapateria-luna.test"]);
    expect(knownFromConfig({})).toEqual([]);
  });
});
