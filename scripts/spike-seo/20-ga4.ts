// Fase 0 · GA4: sesiones y usuarios por fecha, página, país, idioma y fuente; y las sesiones desde asistentes de IA.
// Uso: pnpm exec tsx scripts/spike-seo/20-ga4.ts
import { loadConfig, need } from "./lib/config";
import { dateRange } from "./lib/dates";
import { aiSourceFilter, GA4_SCOPE, isAiSource, runReport } from "./lib/ga4";
import { getAccessToken, readServiceAccountKey } from "./lib/google-auth";
import { Recorder } from "./lib/http";
import { ga4ByPage } from "./lib/join";
import { summarizeByLang } from "./lib/lang";
import { writeJson } from "./lib/out";
import { log, run, table } from "./lib/run";

await run(async () => {
  const cfg = loadConfig();
  const property = need("SPIKE_GA4_PROPERTY", cfg.ga4Property);
  const recorder = new Recorder();
  const token = await getAccessToken(readServiceAccountKey(need("SPIKE_GSC_KEY_FILE", cfg.keyFile)), [GA4_SCOPE], { recorder });
  const ctx = { token, recorder };
  const range = dateRange(cfg.days, cfg.lagDays);
  const metrics = ["sessions", "totalUsers"];

  log(`Informe general ${range.startDate} → ${range.endDate}…`);
  const main = await runReport(ctx, property, { ...range, dimensions: ["date", "pagePath", "country", "language", "sessionSource", "sessionMedium"], metrics });

  log("Sesiones desde asistentes de IA (filtro en el servidor)…");
  const ai = await runReport(ctx, property, { ...range, dimensions: ["date", "sessionSource", "sessionMedium", "pagePath"], metrics, dimensionFilter: aiSourceFilter });

  const total = main.rows.reduce((a, r) => a + (r.metrics.sessions ?? 0), 0);
  const aiTotal = ai.rows.reduce((a, r) => a + (r.metrics.sessions ?? 0), 0);
  const aiLocal = main.rows.filter((r) => isAiSource(r.dims.sessionSource ?? "")).reduce((a, r) => a + (r.metrics.sessions ?? 0), 0);
  const direct = main.rows.filter((r) => (r.dims.sessionSource ?? "") === "(direct)").reduce((a, r) => a + (r.metrics.sessions ?? 0), 0);

  const bySource = new Map<string, number>();
  for (const r of ai.rows) bySource.set(r.dims.sessionSource ?? "", (bySource.get(r.dims.sessionSource ?? "") ?? 0) + (r.metrics.sessions ?? 0));

  const perPage = ga4ByPage(main.rows);
  const langs = summarizeByLang([...perPage].map(([page, t]) => ({ page, clicks: t.sessions, impressions: 0 })), cfg.markets, cfg.defaultLang);

  const summary = {
    property,
    range,
    rows: main.rows.length,
    rowCount: main.rowCount,
    requests: main.requests,
    truncated: main.truncated,
    sessions: total,
    aiSessionsServerFilter: aiTotal,
    aiSessionsLocalRegex: aiLocal,
    directSessions: direct,
    aiSources: Object.fromEntries(bySource),
    pages: perPage.size,
    languagesBySessions: langs.byLang,
    pagesWithoutLanguage: langs.unmatchedCount,
    calls: recorder.summary(),
  };

  writeJson(cfg, "ga4-report", main.rows);
  writeJson(cfg, "ga4-ai", ai.rows);
  writeJson(cfg, "ga4-summary", summary);

  log(`\nFilas: ${summary.rows} · páginas: ${summary.pages} · peticiones: ${summary.requests}${summary.truncated ? " (truncado)" : ""}`);
  log(`Sesiones: ${total} · desde IA: ${aiTotal} (${total ? ((aiTotal / total) * 100).toFixed(2) : "0"} %) · directas: ${direct}`);
  log("\nFuentes de IA:");
  table([...bySource].map(([fuente, sesiones]) => ({ fuente, sesiones })));
  log("\nPor idioma (columna \"clics\" = sesiones):");
  table(Object.entries(langs.byLang).map(([lang, v]) => ({ idioma: lang, páginas: v.pages, sesiones: v.clicks })));
  log(`\nSalida en ${cfg.outDir}`);
});
