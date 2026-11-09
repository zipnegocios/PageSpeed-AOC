import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import { readHeartbeat } from "@/server/queue/heartbeat";
import { getRedis } from "@/server/queue/connection";
import { seoQueue } from "@/server/queue/queues";
import { SEO_SYNC_JOB } from "@/server/queue/schedulers";
import { explainFailure } from "@/server/domain/seo-connections";
import { aggregateAi, aggregateSearch, aggregateTraffic, planSyncWindows, type SyncKind } from "@/server/domain/seo-sync";
import * as repo from "@/server/repositories/seo-integrations";
import * as writes from "@/server/repositories/seo-sync";
import { aiSourceFilter, GA4_SCOPE, runReport } from "@/server/seo/ga4";
import { getAccessToken } from "@/server/seo/google-auth";
import { GSC_SCOPE, searchAnalytics } from "@/server/seo/gsc";
import { SpikeHttpError } from "@/server/seo/http";
import { loadGoogleAccount, type SeoDeps } from "./seo-connections";
import { assertUuid } from "./shared";

const ENQUEUE_TIMEOUT_MS = 8_000;

/**
 * La descarga corre en el worker, que es otro servicio que el web: no comparten variables de entorno. Si el panel dice
 * «Conectado» pero la descarga falla por esto, la cuenta está en el web y falta en el worker.
 */
export const WORKER_NO_ACCOUNT =
  "Falta la cuenta de servicio de Google en el worker (el web y el worker no comparten variables). Define GOOGLE_SERVICE_ACCOUNT_JSON también en el servicio del worker y redespliégalo. Si la guardaste desde SEO → Cuenta de Google, el worker necesita la misma AUTH_ENCRYPTION_KEY que el web.";

/**
 * Pide al worker descargar ahora los datos de Search Console y GA4 de un proyecto. Si ya hay una petición esperando
 * o en curso, no encola otra. Exige que el proyecto tenga alguna de las dos conexiones y un worker en línea.
 */
export async function requestSeoSync(projectId: string, deps: { db?: Database; queue?: Queue; redis?: Redis } = {}): Promise<{ queued: boolean }> {
  assertUuid(projectId, "Proyecto");
  const db = deps.db ?? getDb();
  const connected = (await repo.listForProject(db, projectId)).some((i) => i.kind === "gsc" || i.kind === "ga4");
  if (!connected) throw new DomainError("INVALID", "Conecta Search Console o GA4 antes de actualizar los datos.");

  const redis = deps.redis ?? getRedis();
  if (!(await readHeartbeat(redis))) {
    throw new DomainError("UPSTREAM", "El worker no está en línea. Inicia el servicio worker e inténtalo de nuevo.");
  }

  const queue = deps.queue ?? seoQueue(redis);
  const jobId = `seo-sync-manual-${projectId}`;
  // Con Redis caído las órdenes de BullMQ se quedan esperando para siempre: mejor avisar que dejar el botón colgado.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DomainError("UPSTREAM", "No se pudo pedir la actualización (Redis no responde). Inténtalo de nuevo.")), ENQUEUE_TIMEOUT_MS);
  });
  const enqueue = async (): Promise<{ queued: boolean }> => {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") return { queued: false };
      await existing.remove().catch(() => undefined);
    }
    await queue.add(SEO_SYNC_JOB, { projectId }, { jobId, removeOnComplete: true, removeOnFail: true });
    return { queued: true };
  };
  try {
    return await Promise.race([enqueue(), deadline]);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("UPSTREAM", "No se pudo pedir la actualización (Redis no responde). Inténtalo de nuevo.");
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ descarga

/** Tope de filas por ventana de 30 días: más allá se descartan las páginas con menos tráfico y se avisa. */
const MAX_ROWS_PER_WINDOW = 250_000;

export type KindSyncResult = { kind: SyncKind; ok: boolean; /** Filas guardadas en esta descarga. */ rows: number; /** Último día con datos guardados. */ through: string | null; detail: string };
export type ProjectSyncResult = { projectId: string; results: KindSyncResult[] };

const range = (windows: Array<{ from: string; to: string }>) => `${windows[0]!.from} a ${windows.at(-1)!.to}`;

async function syncGsc(row: repo.SeoIntegration, account: Parameters<typeof getAccessToken>[0], db: Database, deps: SeoDeps, now: Date): Promise<KindSyncResult> {
  const http = { fetchImpl: deps.fetchImpl, sleep: deps.sleep };
  const token = await getAccessToken(account, [GSC_SCOPE], http);
  const windows = planSyncWindows(row.syncedThrough, "gsc", now);
  let rows = 0;
  let through = row.syncedThrough;
  let truncated = false;
  for (const w of windows) {
    const res = await searchAnalytics({ token, ...http }, row.externalId, { startDate: w.from, endDate: w.to, dimensions: ["date", "page", "country", "device"], dataState: "final", maxRows: MAX_ROWS_PER_WINDOW });
    truncated ||= res.truncated;
    const aggregated = aggregateSearch(res.records);
    await writes.replaceSearchWindow(db, row.projectId, w.from, w.to, aggregated);
    await repo.setSyncedThrough(db, row.id, w.to);
    rows += aggregated.length;
    through = w.to;
  }
  const detail = windows.length === 0 ? "Los datos ya estaban al día." : `Se guardaron ${rows} filas de ${range(windows)}.${truncated ? " Alguna ventana llegó al máximo de filas: faltan las páginas con menos tráfico." : ""}`;
  return { kind: "gsc", ok: true, rows, through, detail };
}

async function syncGa4(row: repo.SeoIntegration, account: Parameters<typeof getAccessToken>[0], db: Database, deps: SeoDeps, now: Date): Promise<KindSyncResult> {
  const http = { fetchImpl: deps.fetchImpl, sleep: deps.sleep };
  const token = await getAccessToken(account, [GA4_SCOPE], http);
  const windows = planSyncWindows(row.syncedThrough, "ga4", now);
  let rows = 0;
  let through = row.syncedThrough;
  let truncated = false;
  for (const w of windows) {
    const base = { startDate: w.from, endDate: w.to, metrics: ["sessions", "totalUsers"], maxRows: MAX_ROWS_PER_WINDOW };
    const traffic = await runReport({ token, ...http }, row.externalId, { ...base, dimensions: ["date", "pagePath", "country", "sessionDefaultChannelGroup"] });
    const ai = await runReport({ token, ...http }, row.externalId, { ...base, dimensions: ["date", "sessionSource", "pagePath"], dimensionFilter: aiSourceFilter });
    truncated ||= traffic.truncated || ai.truncated;
    const trafficRows = aggregateTraffic(traffic.rows);
    const aiRows = aggregateAi(ai.rows);
    await writes.replaceTrafficWindow(db, row.projectId, w.from, w.to, trafficRows);
    await writes.replaceAiWindow(db, row.projectId, w.from, w.to, aiRows);
    await repo.setSyncedThrough(db, row.id, w.to);
    rows += trafficRows.length + aiRows.length;
    through = w.to;
  }
  const detail = windows.length === 0 ? "Los datos ya estaban al día." : `Se guardaron ${rows} filas de ${range(windows)}.${truncated ? " Alguna ventana llegó al máximo de filas: faltan las páginas con menos tráfico." : ""}`;
  return { kind: "ga4", ok: true, rows, through, detail };
}

/**
 * Descarga los datos de Search Console y GA4 de un proyecto y anota cómo salió en cada conexión. La primera vez trae los
 * últimos 90 días; después repasa desde una semana antes del último día guardado, porque Google corrige con retraso.
 * Es idempotente: repetirla deja los mismos datos. Un fallo de una fuente no detiene a la otra.
 */
export async function syncProjectSeoData(projectId: string, db: Database = getDb(), deps: SeoDeps = {}): Promise<ProjectSyncResult> {
  assertUuid(projectId, "Proyecto");
  const integrations = (await repo.listForProject(db, projectId)).filter((i) => i.kind === "gsc" || i.kind === "ga4");
  const now = (deps.now ?? (() => new Date()))();
  const results: KindSyncResult[] = [];
  if (integrations.length === 0) return { projectId, results };

  let account: Awaited<ReturnType<typeof loadGoogleAccount>> = null;
  let accountError: string | null = null;
  try {
    account = await loadGoogleAccount(db, deps);
  } catch (err) {
    accountError = err instanceof DomainError ? err.message : "No se pudo leer la cuenta de servicio de Google.";
  }

  for (const row of integrations) {
    const kind = row.kind as SyncKind;
    let result: KindSyncResult;
    try {
      if (!account) throw new DomainError("INVALID", accountError ?? WORKER_NO_ACCOUNT);
      result = kind === "gsc" ? await syncGsc(row, account, db, deps, now) : await syncGa4(row, account, db, deps, now);
    } catch (err) {
      let detail = "No se pudieron descargar los datos. Se reintentará en la próxima descarga.";
      if (err instanceof DomainError) detail = err.message;
      else if (err instanceof SpikeHttpError) detail = explainFailure(kind, err.code, { email: account?.client_email });
      else console.error("[seo] descarga", kind, err instanceof Error ? err.name : "error");
      result = { kind, ok: false, rows: 0, through: row.syncedThrough, detail };
    }
    await repo.recordSync(db, row.id, { status: result.ok ? "ok" : "error", detail: result.detail, at: now });
    results.push(result);
  }
  return { projectId, results };
}

export type SeoSyncSummary = { projects: number; ok: number; failed: number };

/** Ronda diaria: todos los proyectos vigentes con conexión a Search Console o GA4, de uno en uno. */
export async function syncAllSeoData(db: Database = getDb(), deps: SeoDeps = {}): Promise<SeoSyncSummary> {
  const ids = await repo.listSyncProjectIds(db);
  const summary: SeoSyncSummary = { projects: ids.length, ok: 0, failed: 0 };
  for (const id of ids) {
    try {
      const r = await syncProjectSeoData(id, db, deps);
      if (r.results.every((x) => x.ok)) summary.ok += 1;
      else summary.failed += 1;
    } catch (err) {
      // Un proyecto con un fallo inesperado no detiene al resto de la ronda.
      console.error("[seo] ronda diaria", err instanceof Error ? err.name : "error");
      summary.failed += 1;
    }
  }
  return summary;
}
