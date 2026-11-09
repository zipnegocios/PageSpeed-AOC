import { access, constants } from "node:fs/promises";
import { Queue, Worker } from "bullmq";
import pino, { type Logger } from "pino";
import type { WorkerEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { createRedis, QUEUE_PREFIX } from "@/server/queue/connection";
import { clearHeartbeat, writeHeartbeat } from "@/server/queue/heartbeat";
import { LIGHTHOUSE_QUEUE, MAINTENANCE_QUEUE, SEO_QUEUE, type AuditJobData } from "@/server/queue/queues";
import {
  BACKUP_CRON,
  BACKUP_JOB,
  BACKUP_SCHEDULER_ID,
  CRUX_CRON,
  CRUX_JOB,
  CRUX_SCHEDULER_ID,
  NOTIFY_EVERY_MS,
  NOTIFY_JOB,
  NOTIFY_SCHEDULER_ID,
  PLAN_JOB,
  RECONCILE_EVERY_MS,
  RECONCILE_JOB,
  RECONCILE_SCHEDULER_ID,
  SEO_CRAWL_CRON,
  SEO_CRAWL_JOB,
  SEO_CRAWL_SCHEDULER_ID,
  SEO_CRAWL_WEEKLY_JOB,
  SEO_SYNC_CRON,
  SEO_SYNC_JOB,
  SEO_SYNC_SCHEDULER_ID,
} from "@/server/queue/schedulers";
import { createMailer, type Mailer } from "@/server/notify/mailer";
import { resolveAlertRecipient, sweepNotifications } from "@/server/services/alerts";
import { runBackup } from "@/server/services/backups";
import { refreshAllFieldData, refreshOneProjectFieldData, type FetchLike } from "@/server/services/crux";
import type { SeoDeps } from "@/server/services/seo-connections";
import { reconcileCrawlRuns, runCrawl, scheduleWeeklyCrawls, type CrawlDeps } from "@/server/services/seo-crawl";
import { syncAllSeoData, syncProjectSeoData } from "@/server/services/seo-sync";
import { createR2, r2ConfigFromEnv, type R2Store } from "@/server/storage/r2";
import { runLighthouse, type LighthouseRunner } from "./lighthouse/runner";
import { createAuditProcessor } from "./processors/audit.processor";
import { createPlanProjectProcessor } from "./processors/plan-project.processor";
import { reconcile } from "./reconcile";

export type StartWorkerOptions = {
  env: WorkerEnv;
  logger?: Logger;
  /** Solo pruebas: sustituye a Chromium + Lighthouse. */
  runner?: LighthouseRunner;
  /** Solo pruebas/desarrollo: sustituye al cliente de R2. */
  r2?: Pick<R2Store, "putAuditJson" | "putObject" | "listObjects" | "deleteObjects">;
  /** Solo pruebas y script de desarrollo: permite auditar direcciones privadas. */
  allowPrivate?: boolean;
  heartbeatIntervalMs?: number;
  /** Solo pruebas: sustituye a las consultas a la API de Chrome UX Report. */
  cruxFetch?: FetchLike;
  /** Solo pruebas: sustituye a las llamadas a Google y la cuenta de servicio en la descarga de Search Console y GA4. */
  seoDeps?: SeoDeps;
  /** Solo pruebas: sustituye la descarga y los relojes del rastreo técnico (`allowPrivate` del worker también aplica). */
  seoCrawlDeps?: Omit<CrawlDeps, "allowPrivate">;
  /** Solo pruebas: sustituye al envío SMTP. */
  mailer?: Mailer | null;
};

export type RunningWorker = { close(): Promise<void> };

async function fileExists(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Si una tarea de arranque se cuelga, el worker lo dice en los logs y sigue en lugar de quedarse mudo. */
async function withDeadline<T>(task: Promise<T>, ms: number, label: string, log: Logger): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      log.error({ label, ms }, `${label}: sin respuesta tras ${Math.round(ms / 1000)} s; se continúa sin esperar`);
      resolve(undefined);
    }, ms);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const { env } = options;
  const log = options.logger ?? pino({ level: env.LOG_LEVEL, base: { service: "worker" } });
  log.info("worker iniciando");

  // Al vencer el plazo se cierra Chromium a la fuerza y Lighthouse deja un rechazo interno
  // ("Target closed") que no podemos atender. Se registra en lugar de tumbar el worker.
  const onUnhandledRejection = (reason: unknown) =>
    log.warn({ err: reason instanceof Error ? reason.message : String(reason) }, "rechazo no atendido (Lighthouse tras cerrar Chromium)");
  process.on("unhandledRejection", onUnhandledRejection);

  const { db, pool } = createDb(env.DATABASE_URL, 3);
  const redis = createRedis(env.REDIS_URL);
  redis.on("error", (err) => log.error({ err: err.message }, "error de Redis"));
  const ownR2 = options.r2 ? undefined : createR2(r2ConfigFromEnv(env));
  const r2 = options.r2 ?? ownR2!;

  const chromeOk = options.runner ? true : await fileExists(env.CHROME_PATH || undefined);
  if (!options.runner && !chromeOk) {
    log.warn(
      { chromePath: env.CHROME_PATH ?? null },
      "CHROME_PATH no apunta a un Chromium ejecutable: se intentará localizar uno al auditar",
    );
  }

  const processor = createAuditProcessor({
    db,
    r2,
    runner: options.runner ?? runLighthouse,
    log,
    timeoutMs: env.AUDIT_TIMEOUT_MS,
    cooldownMs: env.AUDIT_COOLDOWN_MS,
    chromePath: env.CHROME_PATH || undefined,
    authKey: env.AUTH_ENCRYPTION_KEY || undefined,
    allowPrivate: options.allowPrivate,
  });

  const worker = new Worker(LIGHTHOUSE_QUEUE, processor, {
    connection: redis,
    prefix: QUEUE_PREFIX,
    concurrency: 1, // estricto: una auditoría a la vez
    lockDuration: env.AUDIT_TIMEOUT_MS + 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  });
  worker.on("error", (err) => log.error({ err: err.message }, "error del worker"));
  worker.on("stalled", (jobId) => log.warn({ jobId }, "trabajo detenido; se reencola"));
  worker.on("failed", (job, err) => log.debug({ jobId: job?.id, err: err.message }, "trabajo fallido"));

  // Mantenimiento (cola aparte, sin Chromium): disparos de los agendadores y reconciliación.
  const lighthouse = new Queue<AuditJobData>(LIGHTHOUSE_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });
  const maintenance = new Queue(MAINTENANCE_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });
  lighthouse.on("error", (err) => log.error({ err: err.message }, "error de la cola lighthouse"));
  maintenance.on("error", (err) => log.error({ err: err.message }, "error de la cola maintenance"));
  const seo = new Queue(SEO_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });
  seo.on("error", (err) => log.error({ err: err.message }, "error de la cola seo"));

  const mailer =
    options.mailer !== undefined
      ? options.mailer
      : env.SMTP_HOST && env.EMAIL_FROM
        ? createMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER || undefined, pass: env.SMTP_PASS || undefined, from: env.EMAIL_FROM })
        : null;
  if (!mailer) log.warn("SMTP_HOST o EMAIL_FROM sin definir: las alertas se evalúan pero no se envían por correo");
  if (mailer && env.NODE_ENV === "production" && /localhost|127\.0\.0\.1/.test(env.APP_URL)) {
    log.warn({ appUrl: env.APP_URL }, "APP_URL apunta a localhost: los enlaces de los correos no servirán; defínela en el worker");
  }
  const runNotify = async () => {
    const recipient = await resolveAlertRecipient(env.ALERT_EMAIL, db);
    if (!recipient) {
      log.warn("sin destinatario de alertas: define ALERT_EMAIL o crea el administrador");
      return;
    }
    const r = await sweepNotifications({ db, mailer, recipient, appUrl: env.APP_URL, log });
    if (r.sent || r.failed) log.info(r, "barrido de alertas");
  };

  const runBackupJob = async () => {
    try {
      const done = await runBackup({ db, r2 });
      log.info({ key: done.key, bytes: done.bytes, rows: done.rows, pruned: done.pruned }, "respaldo de Postgres subido a R2");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err: message }, "el respaldo de Postgres falló");
      // Aviso por correo, de mejor esfuerzo: el panel ya muestra el fallo.
      try {
        const to = mailer ? await resolveAlertRecipient(env.ALERT_EMAIL, db) : null;
        if (mailer && to) {
          await mailer.send({
            to,
            subject: "Falló el respaldo de PageSpeed",
            text: `El respaldo diario de la base de datos no se pudo completar.\n\nMotivo: ${message.slice(0, 200)}\n\nRevisa el panel (Cola → Respaldos) y los logs del worker.`,
            html: `<p>El respaldo diario de la base de datos no se pudo completar.</p><p><strong>Motivo:</strong> ${message.slice(0, 200).replace(/[<>&]/g, "")}</p><p>Revisa el panel (Cola → Respaldos) y los logs del worker.</p>`,
          });
        }
      } catch {
        // sin correo, queda en el panel y en los logs
      }
      throw err;
    }
  };

  const runCrux = async (projectId?: string) => {
    const apiKey = env.CRUX_API_KEY || undefined;
    const r = projectId
      ? await refreshOneProjectFieldData(projectId, { db, apiKey, fetch: options.cruxFetch })
      : await refreshAllFieldData({ db, apiKey, fetch: options.cruxFetch });
    if (r.error === "NO_KEY") log.warn("CRUX_API_KEY sin definir: no se piden datos reales de usuarios");
    else if (!r.ok) log.error({ error: r.error, checked: r.checked }, "la actualización de datos reales falló");
    else log.info({ projects: r.projects, checked: r.checked, withData: r.withData }, "datos reales de usuarios actualizados");
  };

  // Descarga de Search Console y GA4: cola propia (una a la vez) para no retrasar el mantenimiento ni las auditorías.
  const runSeoSync = async (projectId?: string) => {
    const deps: SeoDeps = { key: env.AUTH_ENCRYPTION_KEY || undefined, ...options.seoDeps };
    if (projectId) {
      const r = await syncProjectSeoData(projectId, db, deps);
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) log.warn({ projectId, errors: failed.map((f) => ({ kind: f.kind, detail: f.detail })) }, "la descarga de datos SEO terminó con errores");
      else log.info({ projectId, sources: r.results.map((x) => ({ kind: x.kind, rows: x.rows, through: x.through })) }, "datos SEO descargados");
      return;
    }
    const r = await syncAllSeoData(db, deps);
    log.info(r, "ronda diaria de datos SEO");
  };
  // Rastreo técnico de un sitio: un trabajo por rastreo, en la misma cola (una a la vez).
  const runSeoCrawl = async (runId?: string) => {
    if (!runId) return log.warn("trabajo de rastreo sin runId");
    const r = await runCrawl(runId, db, { allowPrivate: options.allowPrivate, ...options.seoCrawlDeps });
    log.info({ runId, status: r.status, outcome: r.outcome, pages: r.pages, issues: r.issues, detail: r.detail }, "rastreo técnico terminado");
  };
  const seoWorker = new Worker(
    SEO_QUEUE,
    async (job) => {
      if (job.name === SEO_SYNC_JOB) return runSeoSync((job.data as { projectId?: string } | undefined)?.projectId);
      if (job.name === SEO_CRAWL_JOB) return runSeoCrawl((job.data as { runId?: string } | undefined)?.runId);
      if (job.name === SEO_CRAWL_WEEKLY_JOB) {
        const r = await scheduleWeeklyCrawls({ db, queue: seo });
        log.info(r, "ronda semanal de rastreo técnico");
        return;
      }
      log.warn({ name: job.name }, "trabajo seo desconocido");
    },
    { connection: redis, prefix: QUEUE_PREFIX, concurrency: 1, lockDuration: 30 * 60_000 },
  );
  seoWorker.on("error", (err) => log.error({ err: err.message }, "error del worker seo"));
  seoWorker.on("failed", (job, err) => log.error({ jobId: job?.id, name: job?.name, err: err.message }, "descarga seo fallida"));

  const planProject = createPlanProjectProcessor({ db, redis, lighthouse, maintenance, log });
  const runReconcile = async () => {
    const report = await reconcile({ db, lighthouse, maintenance, log, timeoutMs: env.AUDIT_TIMEOUT_MS });
    const crawls = await reconcileCrawlRuns({ db, queue: seo });
    if (crawls.failed > 0) log.warn(crawls, "rastreos técnicos perdidos marcados como fallidos");
    return report;
  };
  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === PLAN_JOB) return planProject(job);
      if (job.name === RECONCILE_JOB) {
        await runReconcile();
        return;
      }
      if (job.name === NOTIFY_JOB) return runNotify();
      if (job.name === BACKUP_JOB) return runBackupJob();
      if (job.name === CRUX_JOB) return runCrux((job.data as { projectId?: string } | undefined)?.projectId);
      log.warn({ name: job.name }, "trabajo de mantenimiento desconocido");
    },
    { connection: redis, prefix: QUEUE_PREFIX, concurrency: 1 },
  );
  maintenanceWorker.on("error", (err) => log.error({ err: err.message }, "error del worker de mantenimiento"));
  maintenanceWorker.on("failed", (job, err) => log.error({ jobId: job?.id, name: job?.name, err: err.message }, "mantenimiento fallido"));

  // Al arrancar se corrigen desfases y se registran los agendadores; después, cada 15 minutos.
  await withDeadline(
    runReconcile().catch((err: Error) => log.error({ err: err.message }, "la reconciliación inicial falló")),
    60_000,
    "reconciliación inicial",
    log,
  );
  // `startDate` evita que BullMQ la dispare al instante: la del arranque ya se acaba de ejecutar.
  await withDeadline(
    maintenance
      .upsertJobScheduler(
        RECONCILE_SCHEDULER_ID,
        { every: RECONCILE_EVERY_MS, startDate: new Date(Date.now() + RECONCILE_EVERY_MS) },
        { name: RECONCILE_JOB, data: {} },
      )
      .catch((err: Error) => log.error({ err: err.message }, "no se pudo registrar la reconciliación periódica")),
    30_000,
    "registro de la reconciliación periódica",
    log,
  );

  await withDeadline(
    maintenance
      .upsertJobScheduler(NOTIFY_SCHEDULER_ID, { every: NOTIFY_EVERY_MS, startDate: new Date(Date.now() + 30_000) }, { name: NOTIFY_JOB, data: {} })
      .catch((err: Error) => log.error({ err: err.message }, "no se pudo registrar el barrido de alertas")),
    30_000,
    "registro del barrido de alertas",
    log,
  );

  await withDeadline(
    maintenance
      .upsertJobScheduler(BACKUP_SCHEDULER_ID, { pattern: BACKUP_CRON, tz: "UTC" }, { name: BACKUP_JOB, data: {} })
      .catch((err: Error) => log.error({ err: err.message }, "no se pudo registrar el respaldo diario")),
    30_000,
    "registro del respaldo diario",
    log,
  );

  await withDeadline(
    maintenance
      .upsertJobScheduler(CRUX_SCHEDULER_ID, { pattern: CRUX_CRON, tz: "UTC" }, { name: CRUX_JOB, data: {} })
      .catch((err: Error) => log.error({ err: err.message }, "no se pudo registrar la actualización diaria de datos reales")),
    30_000,
    "registro de datos reales",
    log,
  );

  await withDeadline(
    seo
      .upsertJobScheduler(SEO_SYNC_SCHEDULER_ID, { pattern: SEO_SYNC_CRON, tz: "UTC" }, { name: SEO_SYNC_JOB, data: {} })
      .catch((err: Error) => log.error({ err: err.message }, "no se pudo registrar la descarga diaria de datos SEO")),
    30_000,
    "registro de la descarga de datos SEO",
    log,
  );

  await withDeadline(
    seo
      .upsertJobScheduler(SEO_CRAWL_SCHEDULER_ID, { pattern: SEO_CRAWL_CRON, tz: "UTC" }, { name: SEO_CRAWL_WEEKLY_JOB, data: {} })
      .catch((err: Error) => log.error({ err: err.message }, "no se pudo registrar la ronda semanal de rastreo técnico")),
    30_000,
    "registro de la ronda semanal de rastreo técnico",
    log,
  );

  const beat = () =>
    writeHeartbeat(redis, { chrome: chromeOk }).catch((err: Error) => log.error({ err: err.message }, "latido fallido"));
  await beat();
  const timer = setInterval(beat, options.heartbeatIntervalMs ?? 10_000);

  log.info(
    { cooldownMs: env.AUDIT_COOLDOWN_MS, timeoutMs: env.AUDIT_TIMEOUT_MS, attempts: env.AUDIT_ATTEMPTS, chrome: chromeOk },
    "worker listo: esperando auditorías",
  );

  let closing: Promise<void> | undefined;
  return {
    close() {
      closing ??= (async () => {
        clearInterval(timer);
        process.off("unhandledRejection", onUnhandledRejection);
        // Espera a que termine la auditoría en curso antes de salir.
        await worker.close();
        await maintenanceWorker.close();
        await seoWorker.close();
        await Promise.all([lighthouse.close(), maintenance.close(), seo.close()]).catch(() => undefined);
        await clearHeartbeat(redis).catch(() => undefined);
        await redis.quit().catch(() => undefined);
        ownR2?.destroy();
        await pool.end().catch(() => undefined);
        log.info("worker detenido");
      })();
      return closing;
    },
  };
}
