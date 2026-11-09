// Fase 0 · Informe: arma un borrador de hallazgos en Markdown con lo que haya en la carpeta de salida.
// Cualquier JSON puede faltar: la fila correspondiente dice "sin datos: corre el script X". Solo lee y escribe en la carpeta de salida.
// Uso: pnpm exec tsx scripts/spike-seo/70-report.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./lib/config";
import { readJson } from "./lib/out";
import { buildFindings, buildReport, missingInputs, type ReportInputs } from "./lib/report";
import { log, run, table } from "./lib/run";

await run(async () => {
  const cfg = loadConfig();
  const inputs: ReportInputs = {
    generatedAt: new Date().toISOString(),
    markets: cfg.markets,
    defaultLang: cfg.defaultLang,
    gscSummary: readJson(cfg, "gsc-summary"),
    gscSearch: readJson(cfg, "gsc-search"),
    gscQueries: readJson(cfg, "gsc-queries"),
    ga4Summary: readJson(cfg, "ga4-summary"),
    ga4Report: readJson(cfg, "ga4-report"),
    ga4Ai: readJson(cfg, "ga4-ai"),
    cfSummary: readJson(cfg, "cf-summary"),
    crawlSummary: readJson(cfg, "crawl-summary"),
    crawlPages: readJson(cfg, "crawl-pages"),
    probeSummary: readJson(cfg, "probe-summary"),
    probeRuns: readJson(cfg, "probe-runs"),
    compare: readJson(cfg, "compare"),
  };

  const markdown = buildReport(inputs);
  mkdirSync(cfg.outDir, { recursive: true });
  const path = join(cfg.outDir, "informe-fase-0.md");
  writeFileSync(path, markdown);

  const missing = missingInputs(inputs);
  log(missing.length === 0 ? "Se usaron todos los archivos de salida." : `Faltan ${missing.length} archivo(s): ${missing.map((m) => `${m.file} (${m.script})`).join(", ")}`);
  log("\nVeredictos propuestos:");
  table(buildFindings(inputs).map((f) => ({ "#": f.n, pregunta: f.title, veredicto: f.verdict })));
  log(`\nInforme en ${path}`);
});
