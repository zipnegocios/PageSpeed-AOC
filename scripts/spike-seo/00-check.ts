// Fase 0 · Paso 0: comprueba qué credenciales hay y si cada fuente responde. No descarga datos.
// Uso: pnpm exec tsx scripts/spike-seo/00-check.ts
import { loadConfig } from "./lib/config";
import { cfGraphql, buildAiCrawlerQuery, verifyToken } from "./lib/cloudflare";
import { GA4_SCOPE, runReport } from "./lib/ga4";
import { getAccessToken, readServiceAccountKey } from "./lib/google-auth";
import { GSC_SCOPE, listSites } from "./lib/gsc";
import { Recorder } from "./lib/http";
import { dateRange } from "./lib/dates";
import { log, run } from "./lib/run";

await run(async () => {
  const cfg = loadConfig();
  const recorder = new Recorder();
  const results: Array<{ fuente: string; estado: string; detalle: string }> = [];

  const attempt = async (fuente: string, configured: boolean, missing: string, fn: () => Promise<string>) => {
    if (!configured) return void results.push({ fuente, estado: "sin configurar", detalle: missing });
    try {
      results.push({ fuente, estado: "ok", detalle: await fn() });
    } catch (err) {
      results.push({ fuente, estado: "falla", detalle: err instanceof Error ? err.message : String(err) });
    }
  };

  const key = cfg.keyFile ? readServiceAccountKey(cfg.keyFile) : null;
  log(`Carpeta de salida: ${cfg.outDir}`);
  log(`Idiomas: ${cfg.markets.map((m) => `${m.lang}=${m.prefix}`).join(", ") || "(ninguno)"}${cfg.defaultLang ? ` · por defecto: ${cfg.defaultLang}` : ""}\n`);

  await attempt("GSC", !!key && !!cfg.gscSite, "SPIKE_GSC_KEY_FILE y SPIKE_GSC_SITE", async () => {
    const token = await getAccessToken(key!, [GSC_SCOPE], { recorder });
    const sites = await listSites({ token, recorder });
    const mine = sites.find((s) => s.siteUrl === cfg.gscSite);
    return mine ? `acceso como ${mine.permissionLevel} a ${mine.siteUrl}` : `la cuenta ve ${sites.length} propiedades, pero no ${cfg.gscSite}`;
  });

  await attempt("GA4", !!key && !!cfg.ga4Property, "SPIKE_GSC_KEY_FILE y SPIKE_GA4_PROPERTY", async () => {
    const token = await getAccessToken(key!, [GA4_SCOPE], { recorder });
    const { startDate, endDate } = dateRange(7, cfg.lagDays);
    const res = await runReport({ token, recorder }, cfg.ga4Property!, { startDate, endDate, dimensions: ["date"], metrics: ["sessions"], pageSize: 1 });
    return `la propiedad responde (${res.rowCount ?? 0} días con datos entre ${startDate} y ${endDate})`;
  });

  await attempt("Cloudflare", !!cfg.cfToken && !!cfg.cfZone, "SPIKE_CF_TOKEN y SPIKE_CF_ZONE", async () => {
    const ctx = { token: cfg.cfToken!, recorder };
    const status = await verifyToken(ctx);
    const to = new Date();
    const from = new Date(to.getTime() - 3_600_000);
    const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
    await cfGraphql(ctx, buildAiCrawlerQuery({ zone: cfg.cfZone!, from: iso(from), to: iso(to), limit: 1 }), "cf-check");
    return `token ${status.status}; la zona responde por GraphQL`;
  });

  console.table(results);
  log(`Llamadas: ${recorder.calls.length}`);
  if (results.some((r) => r.estado === "falla")) process.exitCode = 1;
});
