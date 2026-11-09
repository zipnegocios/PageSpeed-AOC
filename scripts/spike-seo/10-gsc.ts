// Fase 0 · Search Console: rendimiento por fecha, página, país y dispositivo; consultas; sitemaps e inspección de URLs.
// Uso: pnpm exec tsx scripts/spike-seo/10-gsc.ts [--inspect 5]
import { dateRange, daysAgo } from "./lib/dates";
import { loadConfig, need } from "./lib/config";
import { getAccessToken, readServiceAccountKey } from "./lib/google-auth";
import { GSC_SCOPE, inspectUrl, listSitemaps, listSites, searchAnalytics } from "./lib/gsc";
import { Recorder } from "./lib/http";
import { gscByPage } from "./lib/join";
import { summarizeByLang } from "./lib/lang";
import { writeJson } from "./lib/out";
import { arg, log, run, table } from "./lib/run";

await run(async () => {
  const cfg = loadConfig();
  const siteUrl = need("SPIKE_GSC_SITE", cfg.gscSite);
  const recorder = new Recorder();
  const token = await getAccessToken(readServiceAccountKey(need("SPIKE_GSC_KEY_FILE", cfg.keyFile)), [GSC_SCOPE], { recorder });
  const ctx = { token, recorder };
  const range = dateRange(cfg.days, cfg.lagDays);

  const sites = await listSites(ctx);
  if (!sites.some((s) => s.siteUrl === siteUrl)) throw new Error(`La cuenta no tiene acceso a ${siteUrl}. Propiedades visibles: ${sites.map((s) => s.siteUrl).join(", ") || "ninguna"}.`);
  const sitemaps = await listSitemaps(ctx, siteUrl);

  log(`Rendimiento ${range.startDate} → ${range.endDate} (datos ${cfg.gscDataState})…`);
  const main = await searchAnalytics(ctx, siteUrl, { ...range, dimensions: ["date", "page", "country", "device"], dataState: cfg.gscDataState });
  const queries = await searchAnalytics(ctx, siteUrl, { ...range, dimensions: ["page", "query"], rowLimit: 5000, maxRows: 5000, dataState: cfg.gscDataState });

  const perPage = gscByPage(main.records);
  const pages = [...perPage].map(([page, t]) => ({ page, ...t }));
  const langs = summarizeByLang(pages, cfg.markets, cfg.defaultLang);
  const dates = [...new Set(main.records.map((r) => r.keys.date ?? ""))].filter(Boolean).sort();
  const lastDate = dates.at(-1) ?? null;
  const totals = main.records.reduce((a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }), { clicks: 0, impressions: 0 });

  // Inspección de URL: solo una muestra de las páginas con más clics, por la cuota diaria de la API.
  const n = Number(arg("inspect") ?? 5);
  const clicksByUrl = new Map<string, number>();
  for (const r of main.records) clicksByUrl.set(r.keys.page ?? "", (clicksByUrl.get(r.keys.page ?? "") ?? 0) + r.clicks);
  const sample = [...clicksByUrl].filter(([url]) => url).sort((a, b) => b[1] - a[1]).slice(0, n).map(([url]) => url);
  const inspection: Array<{ url: string; result?: unknown; error?: string }> = [];
  for (const url of sample) {
    try {
      inspection.push({ url, result: await inspectUrl(ctx, siteUrl, url) });
    } catch (err) {
      inspection.push({ url, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const summary = {
    siteUrl,
    range,
    dataState: cfg.gscDataState,
    rows: main.records.length,
    requests: main.requests,
    truncated: main.truncated,
    totals,
    pages: perPage.size,
    countries: new Set(main.records.map((r) => r.keys.country)).size,
    lastDateWithData: lastDate,
    delayDays: lastDate ? daysAgo(lastDate) : null,
    languages: langs,
    queryRows: queries.records.length,
    sitemaps: sitemaps.length,
    inspected: inspection.length,
    calls: recorder.summary(),
  };

  writeJson(cfg, "gsc-sites", sites);
  writeJson(cfg, "gsc-sitemaps", sitemaps);
  writeJson(cfg, "gsc-search", main.records);
  writeJson(cfg, "gsc-queries", queries.records);
  writeJson(cfg, "gsc-inspection", inspection);
  writeJson(cfg, "gsc-summary", summary);

  log(`\nFilas: ${summary.rows} · páginas: ${summary.pages} · países: ${summary.countries} · peticiones: ${summary.requests}${summary.truncated ? " (truncado)" : ""}`);
  log(`Clics: ${totals.clicks} · impresiones: ${totals.impressions} · último día con datos: ${lastDate} (retraso: ${summary.delayDays} días)`);
  log("\nPor idioma (según el prefijo de la ruta):");
  table(Object.entries(langs.byLang).map(([lang, v]) => ({ idioma: lang, páginas: v.pages, clics: v.clicks, impresiones: v.impressions, "sin prefijo": v.viaDefault })));
  log(`Páginas sin idioma identificado: ${langs.unmatchedCount}`);
  log("\nLlamadas:");
  table(summary.calls.map((c) => ({ llamada: c.label, n: c.calls, "ms totales": c.totalMs, estados: JSON.stringify(c.statuses) })));
  log(`\nSalida en ${cfg.outDir}`);
});
