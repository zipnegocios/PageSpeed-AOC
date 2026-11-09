import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_USER_AGENTS, buildAiCrawlerQuery, buildAiReferralQuery, cfGraphql, matchAiBot } from "../../scripts/spike-seo/lib/cloudflare";
import { checkHreflang, extractSeo, parseSitemap, sameHost, samplePages } from "../../scripts/spike-seo/lib/crawl";
import { dateRange, eachDay } from "../../scripts/spike-seo/lib/dates";
import { isAiSource, runReport } from "../../scripts/spike-seo/lib/ga4";
import { clearTokenCache, getAccessToken, readServiceAccountKey } from "../../scripts/spike-seo/lib/google-auth";
import { inspectUrl, searchAnalytics } from "../../scripts/spike-seo/lib/gsc";
import { Recorder, requestJson, SpikeHttpError, type FetchLike } from "../../scripts/spike-seo/lib/http";
import { coverage, ga4ByPage, gscByPage } from "../../scripts/spike-seo/lib/join";
import { classifyPath, parseMarkets, summarizeByLang } from "../../scripts/spike-seo/lib/lang";
import { detectMention, summarizeRuns, type ProbeRun } from "../../scripts/spike-seo/lib/probe";
import { pagePath } from "../../scripts/spike-seo/lib/urls";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => undefined;

describe("urls y idiomas", () => {
  it("normaliza URLs y rutas a una misma clave", () => {
    expect(pagePath("https://ejemplo.com/es/precios/?utm=1#top")).toBe("/es/precios");
    expect(pagePath("/es/precios/")).toBe("/es/precios");
    expect(pagePath("https://ejemplo.com")).toBe("/");
    expect(pagePath("/es/index.html")).toBe("/es");
    expect(pagePath("/es/caf%C3%A9")).toBe("/es/café");
  });

  it("interpreta SPIKE_LANGS y rechaza formatos inválidos", () => {
    expect(parseMarkets("es=/es, en=en/")).toEqual([
      { lang: "es", prefix: "/es" },
      { lang: "en", prefix: "/en" },
    ]);
    expect(parseMarkets("")).toEqual([]);
    expect(() => parseMarkets("es")).toThrow(/SPIKE_LANGS/);
    expect(() => parseMarkets("es=/")).toThrow(/SPIKE_LANGS/);
  });

  it("clasifica por prefijo sin confundir /es con /espanol", () => {
    const markets = parseMarkets("es=/es,en=/en");
    expect(classifyPath("https://ejemplo.com/es/precios", markets)).toEqual({ lang: "es", how: "prefix" });
    expect(classifyPath("/en", markets)).toEqual({ lang: "en", how: "prefix" });
    expect(classifyPath("/espanol/x", markets)).toEqual({ lang: null, how: "none" });
    expect(classifyPath("/blog", markets, "es")).toEqual({ lang: "es", how: "default" });
  });

  it("resume por idioma y lista las páginas sin idioma por clics", () => {
    const markets = parseMarkets("es=/es,en=/en");
    const s = summarizeByLang(
      [
        { page: "/es/a", clicks: 10, impressions: 100 },
        { page: "/en/a", clicks: 5, impressions: 50 },
        { page: "/blog/x", clicks: 1, impressions: 9 },
        { page: "/otra", clicks: 7, impressions: 20 },
      ],
      markets,
    );
    expect(s.byLang.es).toMatchObject({ pages: 1, clicks: 10 });
    expect(s.unmatchedCount).toBe(2);
    expect(s.unmatchedTop.map((p) => p.page)).toEqual(["/otra", "/blog/x"]);
  });
});

describe("fechas", () => {
  it("deja fuera los días de retraso y cuenta la ventana completa", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(dateRange(28, 3, now)).toEqual({ startDate: "2026-10-11", endDate: "2026-11-07" });
    expect(dateRange(1, 0, now)).toEqual({ startDate: "2026-11-10", endDate: "2026-11-10" });
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("requestJson", () => {
  it("convierte los estados HTTP en errores tipados", async () => {
    const cases: Array<[number, string]> = [
      [400, "BAD_REQUEST"],
      [401, "AUTH"],
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ];
    for (const [status, code] of cases) {
      const fetchImpl: FetchLike = async () => json({ error: { message: "x" } }, status);
      await expect(requestJson({ label: "t", url: "https://x.test", fetchImpl, sleep: noSleep })).rejects.toMatchObject({ code, status });
    }
  });

  it("reintenta 429 y 5xx y anota cada intento", async () => {
    const recorder = new Recorder();
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ ok: true }));
    const out = await requestJson<{ ok: boolean }>({ label: "t", url: "https://x.test", fetchImpl, sleep: noSleep, recorder });
    expect(out.ok).toBe(true);
    expect(recorder.calls.map((c) => c.status)).toEqual([429, 503, 200]);
    expect(recorder.summary()[0]).toMatchObject({ label: "t", calls: 3 });
  });

  it("falla con QUOTA si los reintentos se agotan y con UNAVAILABLE si no hay red", async () => {
    await expect(requestJson({ label: "t", url: "https://x.test", fetchImpl: async () => json({}, 429), retries: 1, sleep: noSleep })).rejects.toMatchObject({ code: "QUOTA" });
    await expect(
      requestJson({
        label: "t",
        url: "https://x.test",
        fetchImpl: async () => {
          throw new Error("red caída");
        },
        retries: 0,
      }),
    ).rejects.toBeInstanceOf(SpikeHttpError);
  });
});

describe("cuenta de servicio de Google", () => {
  beforeEach(() => clearTokenCache());

  it("firma un JWT RS256 con los datos correctos y reutiliza el token", async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const key = { client_email: "pagespeed@proyecto.iam.gserviceaccount.com", private_key: await exportPKCS8(privateKey) };
    const fetchImpl = vi.fn<FetchLike>(async () => json({ access_token: "tok-123", expires_in: 3600 }));

    const token = await getAccessToken(key, ["https://www.googleapis.com/auth/webmasters.readonly"], { fetchImpl });
    expect(token).toBe("tok-123");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const claims = decodeJwt(form.get("assertion")!);
    expect(claims).toMatchObject({ iss: key.client_email, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/webmasters.readonly" });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(3600);

    await getAccessToken(key, ["https://www.googleapis.com/auth/webmasters.readonly"], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rechaza una llave incompleta o con otro token_uri", () => {
    const dir = mkdtempSync(join(tmpdir(), "spike-key-"));
    const write = (name: string, body: unknown) => {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify(body));
      return p;
    };
    expect(() => readServiceAccountKey(write("a.json", { client_email: "a@b" }))).toThrow(/private_key/);
    expect(() => readServiceAccountKey(write("b.json", { client_email: "a@b", private_key: "k", token_uri: "https://evil.test/token" }))).toThrow(/token_uri/);
    expect(readServiceAccountKey(write("c.json", { client_email: "a@b", private_key: "k" }))).toEqual({ client_email: "a@b", private_key: "k" });
    expect(() => readServiceAccountKey(join(dir, "no-existe.json"))).toThrow(/No se pudo leer/);
  });
});

describe("Search Console", () => {
  const row = (page: string, clicks = 1) => ({ keys: ["2026-11-01", page], clicks, impressions: 10, ctr: 0.1, position: 3 });

  it("pagina con startRow y asigna cada clave a su dimensión", async () => {
    const bodies: Array<{ startRow: number; rowLimit: number; dataState: string }> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { startRow: number; rowLimit: number; dataState: string };
      bodies.push(body);
      return json({ rows: body.startRow === 0 ? [row("https://e.com/es/a"), row("https://e.com/es/b")] : [row("https://e.com/en/c")] });
    };
    const res = await searchAnalytics({ token: "t", fetchImpl }, "sc-domain:e.com", { startDate: "2026-11-01", endDate: "2026-11-01", dimensions: ["date", "page"], rowLimit: 2 });
    expect(res.records).toHaveLength(3);
    expect(res.requests).toBe(2);
    expect(res.truncated).toBe(false);
    expect(res.records[0]?.keys).toEqual({ date: "2026-11-01", page: "https://e.com/es/a" });
    expect(bodies.map((b) => b.startRow)).toEqual([0, 2]);
    expect(bodies[0]?.dataState).toBe("final");
  });

  it("marca como truncado al llegar a maxRows y codifica la propiedad en la URL", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return json({ rows: [row("https://e.com/a"), row("https://e.com/b")] });
    };
    const res = await searchAnalytics({ token: "t", fetchImpl }, "sc-domain:e.com", { startDate: "a", endDate: "b", dimensions: ["date", "page"], rowLimit: 2, maxRows: 4 });
    expect(res.truncated).toBe(true);
    expect(res.requests).toBe(2);
    expect(urls[0]).toContain("/sites/sc-domain%3Ae.com/searchAnalytics/query");
  });

  it("inspecciona una URL con el cuerpo esperado", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } }));
    const out = await inspectUrl({ token: "t", fetchImpl }, "sc-domain:e.com", "https://e.com/es/a");
    expect(out).toEqual({ indexStatusResult: { verdict: "PASS" } });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({ inspectionUrl: "https://e.com/es/a", siteUrl: "sc-domain:e.com", languageCode: "es" });
  });
});

describe("GA4", () => {
  const ga = (path: string, sessions: number) => ({ dimensionValues: [{ value: "20261101" }, { value: path }], metricValues: [{ value: String(sessions) }, { value: "2" }] });

  it("pagina con offset y devuelve dimensiones y métricas por nombre", async () => {
    const offsets: number[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { offset: number };
      offsets.push(body.offset);
      return json({ rowCount: 3, rows: body.offset === 0 ? [ga("/es/a", 5), ga("/es/b", 3)] : [ga("/en/c", 1)] });
    };
    const res = await runReport({ token: "t", fetchImpl }, "123", { startDate: "a", endDate: "b", dimensions: ["date", "pagePath"], metrics: ["sessions", "totalUsers"], pageSize: 2 });
    expect(res.rows).toHaveLength(3);
    expect(res.rows[0]).toEqual({ dims: { date: "20261101", pagePath: "/es/a" }, metrics: { sessions: 5, totalUsers: 2 } });
    expect(offsets).toEqual([0, 2]);
  });

  it("exige el ID numérico de la propiedad", async () => {
    await expect(runReport({ token: "t" }, "G-ABC123", { startDate: "a", endDate: "b", dimensions: [], metrics: [] })).rejects.toThrow(/ID numérico/);
  });

  it("reconoce las fuentes de asistentes de IA", () => {
    expect(isAiSource("chatgpt.com")).toBe(true);
    expect(isAiSource("Perplexity")).toBe(true);
    expect(isAiSource("gemini.google.com")).toBe(true);
    expect(isAiSource("google")).toBe(false);
    expect(isAiSource("(direct)")).toBe(false);
  });
});

describe("Cloudflare", () => {
  const zone = "a".repeat(32);
  const window = { zone, from: "2026-11-01T00:00:00Z", to: "2026-11-01T23:59:59Z" };

  it("arma la consulta con todos los rastreadores y rechaza zonas o fechas inválidas", () => {
    const q = buildAiCrawlerQuery(window);
    expect(q).toContain(`zoneTag: "${zone}"`);
    for (const ua of AI_USER_AGENTS) expect(q).toContain(`userAgent_like: "%${ua}%"`);
    expect(buildAiReferralQuery(window)).toContain("clientRefererHost_like");
    expect(() => buildAiCrawlerQuery({ ...window, zone: 'x"}){' })).toThrow(/ID de zona/);
    expect(() => buildAiCrawlerQuery({ ...window, from: "ayer" })).toThrow(/ISO UTC/);
  });

  it("asocia agentes de usuario con su rastreador", () => {
    expect(matchAiBot("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")).toBe("GPTBot");
    expect(matchAiBot("ClaudeBot/1.0")).toBe("ClaudeBot");
    expect(matchAiBot("Mozilla/5.0 Chrome/120")).toBeNull();
  });

  it("devuelve los grupos y convierte errores de GraphQL en excepciones", async () => {
    const ok: FetchLike = async () => json({ data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ count: 4, dimensions: { userAgent: "GPTBot" } }] }] } } });
    expect(await cfGraphql({ token: "t", fetchImpl: ok }, "q", "cf")).toEqual([{ count: 4, dimensions: { userAgent: "GPTBot" } }]);

    const withErrors: FetchLike = async () => json({ errors: [{ message: "cannot request that far back" }] });
    await expect(cfGraphql({ token: "t", fetchImpl: withErrors }, "q", "cf")).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const noZone: FetchLike = async () => json({ data: { viewer: { zones: [] } } });
    await expect(cfGraphql({ token: "t", fetchImpl: noZone }, "q", "cf")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("rastreo mínimo", () => {
  const page = (lang: string, alternates: Array<[string, string]>, extra = "") =>
    `<html lang="${lang}"><head><title>Hola &amp; adiós</title><meta name="description" content="Desc"><link rel="canonical" href="https://e.com/${lang}/">${alternates
      .map(([l, h]) => `<link rel="alternate" hreflang="${l}" href="${h}">`)
      .join("")}${extra}</head><body><h1>Uno</h1></body></html>`;

  it("lee sitemaps normales e índices", () => {
    expect(parseSitemap("<urlset><url><loc>https://e.com/es/a?x=1&amp;y=2</loc></url><url><loc> https://e.com/en/b </loc></url></urlset>")).toEqual({
      urls: ["https://e.com/es/a?x=1&y=2", "https://e.com/en/b"],
      sitemaps: [],
    });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>")).toEqual({ urls: [], sitemaps: ["https://e.com/s1.xml"] });
  });

  it("extrae título, canónica, hreflang, lang y tipos de JSON-LD, y cuenta los bloques rotos", () => {
    const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["WebSite","Thing"]}]}</script><script type="application/ld+json">{roto</script>`;
    const seo = extractSeo(page("es", [["es", "https://e.com/es/"], ["en", "https://e.com/en/"]], ld), "https://e.com/es/");
    expect(seo).toMatchObject({
      title: "Hola & adiós",
      description: "Desc",
      canonical: "https://e.com/es/",
      htmlLang: "es",
      h1Count: 1,
      jsonLdTypes: ["Organization", "Thing", "WebSite"],
      jsonLdErrors: 1,
    });
    expect(seo.hreflang).toEqual([
      { lang: "es", href: "https://e.com/es/" },
      { lang: "en", href: "https://e.com/en/" },
    ]);
  });

  it("detecta hreflang sin reciprocidad ni autorreferencia", () => {
    const es = extractSeo(page("es", [["es", "https://e.com/es/"], ["en", "https://e.com/en/"]]), "https://e.com/es/");
    const enOk = extractSeo(page("en", [["en", "https://e.com/en/"], ["es", "https://e.com/es/"]]), "https://e.com/en/");
    const enBad = extractSeo(page("en", [["en", "https://e.com/en/"]]), "https://e.com/en/");
    expect(checkHreflang([es, enOk])).toEqual([]);
    expect(checkHreflang([es, enBad])).toEqual([{ page: "https://e.com/es/", problem: "https://e.com/en/ no devuelve el enlace (falta reciprocidad)" }]);
    const noSelf = extractSeo(page("es", [["en", "https://e.com/en/"]]), "https://e.com/es/");
    expect(checkHreflang([noSelf]).map((i) => i.problem)).toContain("no se declara a sí misma en hreflang");
  });

  it("reparte la muestra entre idiomas y solo admite el mismo host", () => {
    const markets = parseMarkets("es=/es,en=/en");
    const urls = ["https://e.com/es/1", "https://e.com/es/2", "https://e.com/es/3", "https://e.com/en/1", "https://e.com/en/2"];
    expect(samplePages(urls, markets, undefined, 4)).toEqual(["https://e.com/es/1", "https://e.com/en/1", "https://e.com/es/2", "https://e.com/en/2"]);
    expect(sameHost("https://E.com/x", "https://e.com")).toBe(true);
    expect(sameHost("https://otro.com/x", "https://e.com")).toBe(false);
  });
});

describe("cruce de GSC y GA4", () => {
  it("normaliza las páginas y mide la cobertura", () => {
    const gsc = gscByPage([
      { keys: { page: "https://e.com/es/a/" }, clicks: 8, impressions: 80, ctr: 0.1, position: 2 },
      { keys: { page: "https://e.com/es/b" }, clicks: 2, impressions: 20, ctr: 0.1, position: 4 },
    ]);
    const ga4 = ga4ByPage([
      { dims: { pagePath: "/es/a" }, metrics: { sessions: 6, totalUsers: 5 } },
      { dims: { pagePath: "/es/a?x=1" }, metrics: { sessions: 4, totalUsers: 3 } },
      { dims: { pagePath: "/es/c" }, metrics: { sessions: 10, totalUsers: 9 } },
    ]);
    expect(ga4.get("/es/a")).toEqual({ sessions: 10, users: 8 });
    expect(coverage(gsc, ga4)).toEqual({ gscPages: 2, ga4Pages: 2, inBoth: 1, onlyGsc: 1, onlyGa4: 1, gscClicksShareInGa4: 0.8, ga4SessionsShareInGsc: 0.5 });
  });
});

describe("sondeo de IA", () => {
  const target = { brands: ["Acme Café"], domain: "acme.com" };

  it("detecta menciones sin distinguir acentos y citas del dominio o sus subdominios", () => {
    const m = detectMention(
      { text: "Recomiendo ACME CAFE para tu negocio.", citations: [{ url: "https://www.acme.com/es/x" }, { url: "https://blog.acme.com/p" }, { url: "https://rival.com/y" }, { url: "no es url" }] },
      target,
    );
    expect(m).toEqual({ mentioned: true, cited: true, citedUrls: ["https://www.acme.com/es/x", "https://blog.acme.com/p"], otherDomains: ["rival.com"] });
    expect(detectMention({ text: "Otra empresa.", citations: [{ url: "https://notacme.com" }] }, target)).toMatchObject({ mentioned: false, cited: false, otherDomains: ["notacme.com"] });
  });

  it("calcula la tasa de mención y de cita por pregunta", () => {
    const run = (mentioned: boolean, cited: boolean): ProbeRun => ({ provider: "mock", lang: "es", prompt: "p", repeat: 1, at: "", mentioned, cited, citedUrls: [], otherDomains: [], excerpt: "" });
    expect(summarizeRuns([run(true, true), run(true, false), run(false, false), run(false, false)])).toEqual([{ provider: "mock", lang: "es", prompt: "p", runs: 4, mentionRate: 0.5, citedRate: 0.25 }]);
  });
});
