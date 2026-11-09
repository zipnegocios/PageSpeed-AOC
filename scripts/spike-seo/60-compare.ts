// Fase 0 · Comparación: totales de GSC y GA4 para contrastar a mano con sus interfaces, y cobertura del cruce por página.
// Requiere haber corrido 10-gsc.ts y 20-ga4.ts. Uso: pnpm exec tsx scripts/spike-seo/60-compare.ts
import { loadConfig } from "./lib/config";
import type { Ga4Row } from "./lib/ga4";
import type { GscRecord } from "./lib/gsc";
import { coverage, ga4ByPage, gscByPage } from "./lib/join";
import { readJson, writeJson } from "./lib/out";
import { log, run } from "./lib/run";

await run(async () => {
  const cfg = loadConfig();
  const gsc = readJson<GscRecord[]>(cfg, "gsc-search");
  const ga4 = readJson<Ga4Row[]>(cfg, "ga4-report");
  if (!gsc || !ga4) throw new Error("Faltan gsc-search.json o ga4-report.json: corre antes 10-gsc.ts y 20-ga4.ts.");

  const totals = {
    gscClicks: gsc.reduce((a, r) => a + r.clicks, 0),
    gscImpressions: gsc.reduce((a, r) => a + r.impressions, 0),
    ga4Sessions: ga4.reduce((a, r) => a + (r.metrics.sessions ?? 0), 0),
    ga4Users: ga4.reduce((a, r) => a + (r.metrics.totalUsers ?? 0), 0),
  };
  const cov = coverage(gscByPage(gsc), ga4ByPage(ga4));
  writeJson(cfg, "compare", { totals, coverage: cov });

  log("Contrasta estas cifras a mano con las interfaces (mismo periodo, mismos filtros):\n");
  console.table({
    "GSC · clics": totals.gscClicks,
    "GSC · impresiones": totals.gscImpressions,
    "GA4 · sesiones": totals.ga4Sessions,
    "GA4 · usuarios": totals.ga4Users,
  });
  log("Cruce por página tras normalizar las URL:");
  console.table({
    "páginas en GSC": cov.gscPages,
    "páginas en GA4": cov.ga4Pages,
    "en ambas": cov.inBoth,
    "solo GSC": cov.onlyGsc,
    "solo GA4": cov.onlyGa4,
    "% clics de GSC en páginas con GA4": Math.round(cov.gscClicksShareInGa4 * 100),
    "% sesiones de GA4 en páginas con GSC": Math.round(cov.ga4SessionsShareInGsc * 100),
  });
  log("Nota: al agrupar por consulta GSC omite las consultas anónimas; los totales por fecha o página sí cuadran con la interfaz.");
});
