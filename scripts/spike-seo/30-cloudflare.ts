// Fase 0 · Cloudflare: solicitudes de rastreadores de IA, rutas más rastreadas y referidos de asistentes.
// Se consulta día por día para descubrir cuánto historial conserva el plan del cliente.
// Uso: pnpm exec tsx scripts/spike-seo/30-cloudflare.ts [--days 7]
import { buildAiCrawlerQuery, buildAiPathsQuery, buildAiReferralQuery, cfGraphql, matchAiBot, verifyToken } from "./lib/cloudflare";
import { loadConfig, need } from "./lib/config";
import { dateRange, eachDay } from "./lib/dates";
import { Recorder, SpikeHttpError } from "./lib/http";
import { writeJson } from "./lib/out";
import { arg, log, run, table } from "./lib/run";

await run(async () => {
  const cfg = loadConfig();
  const zone = need("SPIKE_CF_ZONE", cfg.cfZone);
  const recorder = new Recorder();
  const ctx = { token: need("SPIKE_CF_TOKEN", cfg.cfToken), recorder };
  const days = Number(arg("days") ?? 7);
  const { startDate, endDate } = dateRange(days, 0);

  log(`Token: ${(await verifyToken(ctx)).status}`);

  const perDay: Array<{ día: string; estado: string; solicitudes: number }> = [];
  const byBot = new Map<string, { requests: number; bytes: number }>();
  for (const day of eachDay(startDate, endDate)) {
    const window = { zone, from: `${day}T00:00:00Z`, to: `${day}T23:59:59Z` };
    try {
      const groups = await cfGraphql(ctx, buildAiCrawlerQuery(window), `cf-crawlers-${day}`);
      let requests = 0;
      for (const g of groups) {
        const bot = matchAiBot(g.dimensions.userAgent ?? "") ?? "otro";
        const e = byBot.get(bot) ?? { requests: 0, bytes: 0 };
        e.requests += g.count;
        e.bytes += g.sum?.edgeResponseBytes ?? 0;
        byBot.set(bot, e);
        requests += g.count;
      }
      perDay.push({ día: day, estado: "ok", solicitudes: requests });
    } catch (err) {
      // Un día fuera del historial del plan suele fallar: es un dato, no un error del script.
      perDay.push({ día: day, estado: err instanceof SpikeHttpError ? `${err.code}` : "falla", solicitudes: 0 });
    }
  }

  const last = dateRange(1, 0);
  const lastWindow = { zone, from: `${last.endDate}T00:00:00Z`, to: `${last.endDate}T23:59:59Z` };
  const paths = await cfGraphql(ctx, buildAiPathsQuery(lastWindow), "cf-paths").catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  const referrals = await cfGraphql(ctx, buildAiReferralQuery(lastWindow), "cf-referrals").catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

  const summary = {
    zone,
    range: { startDate, endDate },
    perDay,
    byBot: Object.fromEntries(byBot),
    pathsSample: Array.isArray(paths) ? paths.slice(0, 20) : paths,
    referralsSample: Array.isArray(referrals) ? referrals.slice(0, 20) : referrals,
    calls: recorder.summary(),
  };
  writeJson(cfg, "cf-summary", summary);

  log("\nPor día:");
  table(perDay);
  log("Por bot:");
  table([...byBot].map(([bot, v]) => ({ bot, solicitudes: v.requests, bytes: v.bytes })));
  if (!Array.isArray(referrals)) log(`Referidos: ${referrals.error} (suele requerir un plan de pago)`);
  log(`\nSalida en ${cfg.outDir}`);
});
