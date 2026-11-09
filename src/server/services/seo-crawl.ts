import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import { toPageRows } from "@/server/domain/seo-crawl-rows";
import { evaluate, summarize, type SeverityCounts } from "@/server/domain/seo-crawl-rules";
import { getRedis } from "@/server/queue/connection";
import { readHeartbeat } from "@/server/queue/heartbeat";
import { seoQueue } from "@/server/queue/queues";
import { crawlJobId, SEO_CRAWL_JOB } from "@/server/queue/schedulers";
import { findProject } from "@/server/repositories/projects";
import { listRoutes } from "@/server/repositories/routes";
import * as repo from "@/server/repositories/seo-crawl";
import { listMarkets } from "@/server/repositories/seo-markets";
import { crawl, DEFAULT_LIMITS, type CrawlOptions, type CrawlOutcome } from "@/server/seo/crawler";
import { assertUuid, isUniqueViolation } from "./shared";

const ENQUEUE_TIMEOUT_MS = 8_000;
/** Cuántos rastreos terminados conservan sus páginas y hallazgos por proyecto. */
export const KEEP_RUNS = 12;
/** Un rastreo en cola sin trabajo en Redis desde hace más de esto se da por perdido. */
const STALE_QUEUED_MS = 5 * 60_000;
/** Un rastreo en curso desde hace más que esto (el plazo del rastreador es 20 minutos) y sin trabajo activo se da por perdido. */
const STALE_RUNNING_MS = 45 * 60_000;

/** Lo que se puede sustituir al rastrear: solo pruebas y desarrollo. */
export type CrawlDeps = Pick<CrawlOptions, "fetchHop" | "sleep" | "now" | "allowPrivate">;

export type CrawlRequest = { queued: boolean; /** El rastreo pedido o, si ya había uno activo, ese. */ runId: string | null };

/** Crea el rastreo y su trabajo. Si el proyecto ya tiene uno en cola o en curso, devuelve ese y no encola otro. */
async function enqueueRun(db: Database, queue: Queue, projectId: string, trigger: "manual" | "scheduled"): Promise<CrawlRequest> {
  let runId: string;
  try {
    runId = (await repo.createRun(db, projectId, trigger)).id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return { queued: false, runId: (await repo.findActiveRun(db, projectId))?.id ?? null };
  }
  // Con Redis caído las órdenes de BullMQ se quedan esperando para siempre: mejor fallar que dejar el botón colgado.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      queue.add(SEO_CRAWL_JOB, { runId }, { jobId: crawlJobId(runId), attempts: 1, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 30 * 24 * 3600 } }),
      deadline,
    ]);
  } catch {
    // Sin trabajo, el rastreo en cola bloquearía al proyecto: se cierra como fallido y se avisa.
    await repo.failRun(db, runId, "No se pudo encolar el rastreo (Redis no responde).", "enqueue");
    throw new DomainError("UPSTREAM", "No se pudo pedir el rastreo (Redis no responde). Inténtalo de nuevo.");
  } finally {
    clearTimeout(timer);
  }
  return { queued: true, runId };
}

/**
 * Pide al worker rastrear un proyecto ahora. Sirve para cualquier proyecto, también los de desarrollo. Si ya hay un
 * rastreo en cola o en curso, no encola otro. Exige un worker en línea.
 */
export async function requestCrawl(projectId: string, deps: { db?: Database; queue?: Queue; redis?: Redis } = {}): Promise<CrawlRequest> {
  assertUuid(projectId, "Proyecto");
  const db = deps.db ?? getDb();
  if (!(await findProject(db, projectId))) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const redis = deps.redis ?? getRedis();
  if (!(await readHeartbeat(redis))) throw new DomainError("UPSTREAM", "El worker no está en línea. Inicia el servicio worker e inténtalo de nuevo.");
  return enqueueRun(db, deps.queue ?? seoQueue(redis), projectId, "manual");
}

export type WeeklyCrawlSummary = { projects: number; queued: number; skipped: number; failed: number };

/** Ronda semanal: encola un rastreo por cada proyecto en producción con conexión SEO que no tenga uno activo. */
export async function scheduleWeeklyCrawls(deps: { db?: Database; queue: Queue }): Promise<WeeklyCrawlSummary> {
  const db = deps.db ?? getDb();
  const ids = await repo.listCrawlProjectIds(db);
  const summary: WeeklyCrawlSummary = { projects: ids.length, queued: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    try {
      const r = await enqueueRun(db, deps.queue, id, "scheduled");
      if (r.queued) summary.queued += 1;
      else summary.skipped += 1;
    } catch (err) {
      // Un proyecto con un fallo no detiene al resto de la ronda.
      console.error("[seo] ronda semanal de rastreo", err instanceof Error ? err.name : "error");
      summary.failed += 1;
    }
  }
  return summary;
}

// ------------------------------------------------------------------ ejecución

export type RunSummary = {
  runId: string;
  /** `skipped`: el rastreo ya no estaba en cola (lo tomó otro trabajo o se canceló). */
  status: "succeeded" | "partial" | "failed" | "skipped";
  outcome: CrawlOutcome | "error" | null;
  pages: number;
  issues: SeverityCounts | null;
  detail: string | null;
};

const STATUS_OF: Record<CrawlOutcome, "succeeded" | "partial" | "failed"> = {
  complete: "succeeded",
  partial: "partial",
  site_blocked: "failed",
  blocked_by_site: "failed",
  login_required: "failed",
  unreachable: "failed",
};

/** Hechos del proyecto que necesita el rastreador. La dirección y los hosts permitidos salen del proyecto, nunca de la petición. */
async function crawlTarget(db: Database, projectId: string) {
  const project = await findProject(db, projectId);
  if (!project) return null;
  const allowedHosts = project.allowedHosts.length > 0 ? project.allowedHosts : [new URL(project.baseUrl).hostname];
  const seedPaths = (await listRoutes(db, projectId)).filter((r) => !r.requiresAuth).map((r) => r.path);
  return { baseUrl: project.baseUrl, sitemapUrl: project.sitemapUrl, allowedHosts, seedPaths };
}

/**
 * Ejecuta un rastreo ya creado: lo toma, rastrea, evalúa las reglas y guarda páginas y hallazgos en una transacción. Lo que
 * salga mal queda en el propio rastreo como fallido, con un mensaje legible; no lanza errores al worker (un reintento
 * del mismo rastreo no tiene sentido).
 */
export async function runCrawl(runId: string, db: Database = getDb(), deps: CrawlDeps = {}): Promise<RunSummary> {
  assertUuid(runId, "Rastreo");
  const run = await repo.getRun(db, runId);
  const skipped: RunSummary = { runId, status: "skipped", outcome: null, pages: 0, issues: null, detail: null };
  if (!run || run.status !== "queued") return skipped;
  if (!(await repo.markRunning(db, runId, { ...DEFAULT_LIMITS }))) return skipped;

  const failed = async (detail: string, outcome: "error" = "error"): Promise<RunSummary> => {
    await repo.failRun(db, runId, detail, outcome);
    return { runId, status: "failed", outcome, pages: 0, issues: null, detail };
  };

  try {
    const target = await crawlTarget(db, run.projectId);
    if (!target) return await failed("El proyecto ya no existe o está archivado.");
    const markets = await listMarkets(db, run.projectId);
    const result = await crawl({ ...target, ...deps });
    const status = STATUS_OF[result.outcome];

    const keep = status !== "failed";
    const issues = keep ? evaluate({ pages: result.pages, site: result.site, markets }) : [];
    const pages = keep ? toPageRows(result.pages, result.site, markets) : [];
    const closed = await repo.finishRun(
      db,
      runId,
      { status, outcome: result.outcome, detail: result.detail, pagesCrawled: result.pages.length, pagesDiscovered: result.discovered, requests: result.requests, truncatedBy: result.truncatedBy },
      pages,
      issues,
    );
    // Si la reconciliación lo cerró mientras tanto, no se pisa y no se poda.
    if (!closed) return { ...skipped, detail: "El rastreo ya estaba cerrado." };
    await repo.pruneRuns(db, run.projectId, KEEP_RUNS);
    return { runId, status, outcome: result.outcome, pages: result.pages.length, issues: keep ? summarize(issues) : null, detail: result.detail };
  } catch (err) {
    console.error("[seo] rastreo", err instanceof Error ? err.name : "error");
    return failed("El rastreo falló por un error inesperado. Inténtalo de nuevo; si se repite, revisa los registros del worker.");
  }
}

// ------------------------------------------------------------------ reconciliación

const ALIVE = new Set(["waiting", "prioritized", "delayed", "waiting-children", "active"]);

/**
 * Postgres es la fuente de verdad y Redis es transitorio: un rastreo en cola cuyo trabajo ya no existe, o en curso desde hace
 * demasiado sin trabajo activo, se marca fallido para no bloquear al proyecto. Es idempotente.
 */
export async function reconcileCrawlRuns(deps: { db?: Database; queue: Queue; now?: Date }): Promise<{ failed: number }> {
  const db = deps.db ?? getDb();
  const now = (deps.now ?? new Date()).getTime();
  let failed = 0;
  for (const run of await repo.listOpenRuns(db)) {
    const since = run.status === "running" ? (run.startedAt ?? run.queuedAt).getTime() : run.queuedAt.getTime();
    if (now - since < (run.status === "running" ? STALE_RUNNING_MS : STALE_QUEUED_MS)) continue;
    const job = await deps.queue.getJob(crawlJobId(run.id));
    const state = job ? await job.getState() : "unknown";
    // Un trabajo activo sigue vivo (BullMQ renueva su bloqueo); uno en espera aún llegará a ejecutarse.
    if (run.status === "running" ? state === "active" : ALIVE.has(state)) continue;
    if (await repo.failRun(db, run.id, "El rastreo se perdió (el worker se detuvo o Redis perdió el trabajo). Vuelve a pedirlo.", "stale")) failed += 1;
  }
  return { failed };
}
