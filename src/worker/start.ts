import { access, constants } from "node:fs/promises";
import { Worker } from "bullmq";
import pino, { type Logger } from "pino";
import type { WorkerEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { createRedis, QUEUE_PREFIX } from "@/server/queue/connection";
import { clearHeartbeat, writeHeartbeat } from "@/server/queue/heartbeat";
import { LIGHTHOUSE_QUEUE } from "@/server/queue/queues";
import { createR2, r2ConfigFromEnv, type R2Store } from "@/server/storage/r2";
import { runLighthouse, type LighthouseRunner } from "./lighthouse/runner";
import { createAuditProcessor } from "./processors/audit.processor";

export type StartWorkerOptions = {
  env: WorkerEnv;
  logger?: Logger;
  /** Solo pruebas: sustituye a Chromium + Lighthouse. */
  runner?: LighthouseRunner;
  /** Solo pruebas/desarrollo: sustituye al cliente de R2. */
  r2?: Pick<R2Store, "putAuditJson">;
  /** Solo pruebas y script de desarrollo: permite auditar direcciones privadas. */
  allowPrivate?: boolean;
  heartbeatIntervalMs?: number;
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

export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const { env } = options;
  const log = options.logger ?? pino({ level: env.LOG_LEVEL, base: { service: "worker" } });

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
