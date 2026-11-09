// Fase 0 · Rastreo mínimo: toma unas páginas del sitemap y extrae título, canónica, hreflang, lang y JSON-LD.
// Solo estima esfuerzo y tipo de hallazgos; el rastreador definitivo es de la fase 2.
// Uso: pnpm exec tsx scripts/spike-seo/40-crawl.ts [--pages 20] [--pause 500]
import { loadConfig, need } from "./lib/config";
import { checkHreflang, extractSeo, parseSitemap, sameHost, samplePages, type PageSeo } from "./lib/crawl";
import { classifyPath } from "./lib/lang";
import { writeJson } from "./lib/out";
import { arg, log, run, table } from "./lib/run";

const UA = "PageSpeedSpike/0 (+auditoria SEO; prueba de la fase 0)";
const MAX_BYTES = 2_000_000;

async function get(url: string): Promise<{ status: number; type: string; body: string; ms: number }> {
  const started = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xml" }, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: (await res.text()).slice(0, MAX_BYTES), ms: Date.now() - started };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

await run(async () => {
  const cfg = loadConfig();
  const siteUrl = need("SPIKE_SITE_URL", cfg.siteUrl);
  const n = Number(arg("pages") ?? 20);
  const pause = Number(arg("pause") ?? 500);

  log(`Sitemap de ${siteUrl}…`);
  const root = await get(new URL("/sitemap.xml", siteUrl).toString());
  if (root.status !== 200) throw new Error(`/sitemap.xml respondió ${root.status}.`);
  const first = parseSitemap(root.body);
  const urls = new Set(first.urls);
  for (const child of first.sitemaps.slice(0, 5)) {
    if (!sameHost(child, siteUrl)) continue;
    const res = await get(child);
    if (res.status === 200) parseSitemap(res.body).urls.forEach((u) => urls.add(u));
    await sleep(pause);
  }
  const candidates = [...urls].filter((u) => sameHost(u, siteUrl));
  const sample = samplePages(candidates, cfg.markets, cfg.defaultLang, n);
  log(`URLs en el sitemap: ${candidates.length} · se rastrean ${sample.length}\n`);

  const pages: Array<PageSeo & { status: number; ms: number; lang: string | null }> = [];
  const failures: Array<{ url: string; error: string }> = [];
  for (const url of sample) {
    try {
      const res = await get(url);
      if (!res.type.includes("html")) {
        failures.push({ url, error: `no es HTML (${res.type || "sin tipo"})` });
      } else {
        pages.push({ ...extractSeo(res.body, url), status: res.status, ms: res.ms, lang: classifyPath(url, cfg.markets, cfg.defaultLang).lang });
      }
    } catch (err) {
      failures.push({ url, error: err instanceof Error ? err.message : String(err) });
    }
    await sleep(pause);
  }

  const issues = checkHreflang(pages);
  const findings = [
    ...pages.filter((p) => !p.title).map((p) => ({ url: p.url, hallazgo: "sin <title>" })),
    ...pages.filter((p) => !p.description).map((p) => ({ url: p.url, hallazgo: "sin meta description" })),
    ...pages.filter((p) => !p.canonical).map((p) => ({ url: p.url, hallazgo: "sin canónica" })),
    ...pages.filter((p) => p.h1Count !== 1).map((p) => ({ url: p.url, hallazgo: `${p.h1Count} etiquetas h1` })),
    ...pages.filter((p) => p.jsonLdTypes.length === 0).map((p) => ({ url: p.url, hallazgo: "sin datos estructurados (JSON-LD)" })),
    ...pages.filter((p) => p.jsonLdErrors > 0).map((p) => ({ url: p.url, hallazgo: `${p.jsonLdErrors} bloque(s) JSON-LD inválido(s)` })),
    ...pages.filter((p) => p.lang && p.htmlLang && !p.htmlLang.toLowerCase().startsWith(p.lang.toLowerCase())).map((p) => ({ url: p.url, hallazgo: `lang="${p.htmlLang}" no coincide con el idioma de la ruta (${p.lang})` })),
    ...issues.map((i) => ({ url: i.page, hallazgo: `hreflang: ${i.problem}` })),
  ];

  writeJson(cfg, "crawl-pages", pages);
  writeJson(cfg, "crawl-summary", { siteUrl, sitemapUrls: candidates.length, crawled: pages.length, failures, findings, avgMs: pages.length ? Math.round(pages.reduce((a, p) => a + p.ms, 0) / pages.length) : null });

  log(`Rastreadas: ${pages.length} · fallos: ${failures.length} · hallazgos: ${findings.length}`);
  table(findings.slice(0, 40).map((f) => ({ url: f.url.slice(0, 70), hallazgo: f.hallazgo })));
  log(`\nSalida en ${cfg.outDir}`);
});
