import { Queue, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";
import { getRedis, QUEUE_PREFIX } from "./connection";

export const LIGHTHOUSE_QUEUE = "lighthouse";
export const MAINTENANCE_QUEUE = "maintenance";

/** Lo único que viaja en el trabajo: la fila de audit_logs es la fuente de verdad. */
export type AuditJobData = { auditId: string };

/** `bulk` (primer escaneo de todo un proyecto) cede el paso a un «Auditar» individual, pero va antes que las programadas. */
export const PRIORITY = { manual: 1, bulk: 2, scheduledDaily: 5, scheduled: 10 } as const;

export function auditAttempts(): number {
  const n = Number(process.env.AUDIT_ATTEMPTS);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

/** Espera base entre reintentos (ms). 30 s por defecto; configurable para pruebas. */
export function retryDelayMs(): number {
  const n = Number(process.env.AUDIT_RETRY_DELAY_MS);
  return Number.isInteger(n) && n > 0 ? n : 30_000;
}

/** Reintentos con espera exponencial; los trabajos terminados se limpian con el tiempo. */
export function auditJobOptions(auditId: string, priority: number, attempts = auditAttempts()): JobsOptions {
  return {
    jobId: auditId,
    priority,
    attempts,
    backoff: { type: "exponential", delay: retryDelayMs() },
    removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
    removeOnFail: { age: 30 * 24 * 3600 },
  };
}

const g = globalThis as unknown as { __pagespeedQueues?: Map<string, Queue> };

function queue<T>(name: string, connection: Redis): Queue<T> {
  g.__pagespeedQueues ??= new Map();
  let q = g.__pagespeedQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection, prefix: QUEUE_PREFIX });
    q.on("error", () => undefined);
    g.__pagespeedQueues.set(name, q);
  }
  return q as Queue<T>;
}

export function lighthouseQueue(connection: Redis = getRedis()): Queue<AuditJobData> {
  return queue<AuditJobData>(LIGHTHOUSE_QUEUE, connection);
}

export function maintenanceQueue(connection: Redis = getRedis()): Queue {
  return queue(MAINTENANCE_QUEUE, connection);
}
