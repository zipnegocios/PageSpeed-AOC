import { UnrecoverableError, type Job } from "bullmq";
import type { Logger } from "pino";
import type { Database } from "@/server/db/client";
import { assertRouteAuditable } from "@/server/domain/audit-rules";
import { classifyError } from "@/server/domain/error-classifier";
import { LighthouseRuntimeError } from "@/server/domain/audit-errors";
import { buildAuditKey } from "@/server/domain/r2-key";
import { extractResults } from "@/server/domain/score-extraction";
import type { AuditJobData } from "@/server/queue/queues";
import * as repo from "@/server/repositories/audits";
import type { R2Store } from "@/server/storage/r2";
import { resolvePinnedHost, type HostResolver } from "../host-pin";
import type { LighthouseRunner } from "../lighthouse/runner";

export type AuditProcessorDeps = {
  db: Database;
  r2: Pick<R2Store, "putAuditJson">;
  runner: LighthouseRunner;
  log: Logger;
  timeoutMs: number;
  cooldownMs: number;
  chromePath?: string;
  /** Solo pruebas y script de desarrollo. El producto no lo expone por entorno. */
  allowPrivate?: boolean;
  resolver?: HostResolver;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Procesa un trabajo de auditoría. La fila de audit_logs es la fuente de verdad: el trabajo solo
 * lleva su id. Tras cada ejecución de Chromium espera `cooldownMs` antes de devolver el control,
 * lo que garantiza una pausa real entre auditorías.
 */
export function createAuditProcessor(deps: AuditProcessorDeps) {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());

  return async function processAudit(job: Job<AuditJobData>): Promise<void> {
    const { auditId } = job.data;
    const log = deps.log.child({ auditId, jobId: job.id });
    const ctx = await repo.findAuditContext(deps.db, auditId);

    if (!ctx || ctx.project.deletedAt) {
      if (ctx) await repo.markFailed(deps.db, auditId, { code: "NOT_FOUND", message: "El proyecto ya no existe." });
      log.warn("auditoría descartada: no existe o su proyecto fue archivado");
      throw new UnrecoverableError("Auditoría o proyecto inexistente");
    }
    if (ctx.audit.status === "succeeded" || ctx.audit.status === "failed") {
      log.warn({ status: ctx.audit.status }, "auditoría ya terminada; se ignora el trabajo");
      return;
    }

    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    await repo.markRunning(deps.db, auditId, attempt);
    log.info({ url: ctx.route.url, profile: ctx.audit.profile, attempt, maxAttempts }, "auditoría iniciada");

    let launched = false;
    try {
      assertRouteAuditable(ctx.route.url, ctx.project.allowedHosts);
      const pinnedHost = await resolvePinnedHost(ctx.route.url, {
        allowPrivate: deps.allowPrivate,
        resolver: deps.resolver,
      });

      launched = true;
      const { lhr } = await deps.runner({
        url: ctx.route.url,
        profile: ctx.audit.profile,
        timeoutMs: deps.timeoutMs,
        chromePath: deps.chromePath,
        pinnedHost,
      });

      const extracted = extractResults(lhr);
      if (!extracted.ok) throw new LighthouseRuntimeError(extracted.code, extracted.message);

      const key = buildAuditKey({
        clientSlug: ctx.clientSlug,
        projectSlug: ctx.project.slug,
        routePath: ctx.route.path,
        profile: ctx.audit.profile,
        auditId,
        at: now(),
      });
      const { bytes } = await deps.r2.putAuditJson(key, lhr);
      await repo.markSucceeded(deps.db, auditId, extracted.metrics, key);
      log.info(
        { key, bytes, performance: extracted.metrics.scorePerformance, seo: extracted.metrics.scoreSeo },
        "auditoría correcta",
      );
    } catch (err) {
      const failure = classifyError(err);
      const isLast = !failure.retryable || attempt >= maxAttempts;
      if (isLast) {
        await repo.markFailed(deps.db, auditId, failure);
        log.warn({ code: failure.code, attempt }, `auditoría fallida: ${failure.message}`);
      } else {
        await repo.markRetry(deps.db, auditId, failure);
        log.warn({ code: failure.code, attempt, maxAttempts }, `intento fallido, se reintentará: ${failure.message}`);
      }
      if (launched) await sleep(deps.cooldownMs);
      // Un error no reintentable corta los reintentos de BullMQ.
      throw failure.retryable ? new Error(failure.message) : new UnrecoverableError(failure.message);
    }

    await sleep(deps.cooldownMs);
  };
}
