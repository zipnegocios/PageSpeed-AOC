import { UnrecoverableError, type Job } from "bullmq";
import type { Logger } from "pino";
import type { Database } from "@/server/db/client";
import { assertRouteAuditable } from "@/server/domain/audit-rules";
import { AuthFailedError } from "@/server/domain/audit-errors";
import { resolveProjectAuth } from "@/server/services/project-auth";
import { classifyError, withNote } from "@/server/domain/error-classifier";
import { LighthouseRuntimeError } from "@/server/domain/audit-errors";
import { buildAuditKey } from "@/server/domain/r2-key";
import { extractImprovements } from "@/server/domain/improvements";
import { extractResults, type LhrLike } from "@/server/domain/score-extraction";
import { localizeLhr } from "@/server/report/lighthouse-report";
import type { AuditJobData } from "@/server/queue/queues";
import * as repo from "@/server/repositories/audits";
import { evaluateAudit, evaluateFailure } from "@/server/services/alerts";
import type { R2Store } from "@/server/storage/r2";
import { resolvePinnedHost, type HostResolver } from "../host-pin";
import type { ProjectAuthConfig } from "@/server/domain/project-auth";
import type { LighthouseRunner } from "../lighthouse/runner";
import { describeProbe, pinIsCulprit, probeSite } from "../lighthouse/probe";

export type AuditProcessorDeps = {
  db: Database;
  r2: Pick<R2Store, "putAuditJson">;
  runner: LighthouseRunner;
  log: Logger;
  timeoutMs: number;
  cooldownMs: number;
  chromePath?: string;
  /** AUTH_ENCRYPTION_KEY: descifra las credenciales de las rutas privadas. */
  authKey?: string;
  /** Solo pruebas y script de desarrollo. El producto no lo expone por entorno. */
  allowPrivate?: boolean;
  resolver?: HostResolver;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Evaluación de alertas; se puede sustituir en pruebas. */
  alerts?: { evaluateAudit: typeof evaluateAudit; evaluateFailure: typeof evaluateFailure };
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
  const alerts = deps.alerts ?? { evaluateAudit, evaluateFailure };

  /** Las alertas son de mejor esfuerzo: un fallo aquí jamás cambia el resultado de la auditoría. */
  async function evaluate(kind: "success" | "failure", auditId: string, log: Logger): Promise<void> {
    try {
      const run = kind === "success" ? alerts.evaluateAudit : alerts.evaluateFailure;
      const r = await run(auditId, { db: deps.db, now });
      if (r.opened || r.resolved) log.info(r, "alertas actualizadas");
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "no se pudieron evaluar las alertas");
    }
  }

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
    let diagnosis = "";
    try {
      assertRouteAuditable(ctx.route.url, ctx.project.allowedHosts);
      const pinnedHost = await resolvePinnedHost(ctx.route.url, {
        allowPrivate: deps.allowPrivate,
        resolver: deps.resolver,
      });

      // Ruta privada: se descifra el acceso del proyecto y se valida (y fija) también el host del login.
      let auth: { config: ProjectAuthConfig; allowedHosts: string[] } | undefined;
      let extraPinnedHosts: Awaited<ReturnType<typeof resolvePinnedHost>>[] = [];
      if (ctx.route.requiresAuth) {
        const config = resolveProjectAuth(ctx.project, deps.authKey);
        if (!config) {
          throw new AuthFailedError("AUTH_NOT_CONFIGURED", "La ruta requiere iniciar sesión, pero el proyecto no tiene el acceso configurado.");
        }
        auth = { config, allowedHosts: ctx.project.allowedHosts };
        if (config.strategy === "form") {
          assertRouteAuditable(config.loginUrl, ctx.project.allowedHosts);
          const loginPin = await resolvePinnedHost(config.loginUrl, { allowPrivate: deps.allowPrivate, resolver: deps.resolver });
          if (loginPin && loginPin.host !== pinnedHost?.host) extraPinnedHosts = [loginPin];
        }
      }

      launched = true;
      const run = async (pin: typeof pinnedHost) => {
        const { lhr } = await deps.runner({
          url: ctx.route.url,
          profile: ctx.audit.profile,
          timeoutMs: deps.timeoutMs,
          chromePath: deps.chromePath,
          pinnedHost: pin,
          extraPinnedHosts: extraPinnedHosts.filter((p): p is NonNullable<typeof p> => Boolean(p)),
          auth,
        });
        const out = extractResults(lhr);
        if (!out.ok) throw new LighthouseRuntimeError(out.code, out.message);
        return { lhr, extracted: out };
      };

      let result: Awaited<ReturnType<typeof run>>;
      try {
        result = await run(pinnedHost);
      } catch (err) {
        // Un 4xx o «sitio caído» con el sitio funcionando en PageSpeed Insights: se mira desde el worker quién rechaza (IP fijada, agente o IP del
        // worker) y se deja en el mensaje. Si la culpable es la IP fijada, se reintenta una vez con el DNS normal (la IP ya se validó como pública).
        const first = classifyError(err);
        if (!(first.code === "HTTP_4XX" || first.code === "SITE_DOWN") || ctx.route.requiresAuth) throw err;
        const probe = await probeSite(ctx.route.url, ctx.audit.profile, pinnedHost, { allowPrivate: deps.allowPrivate, resolver: deps.resolver });
        diagnosis = describeProbe(probe);
        if (!pinIsCulprit(probe)) throw err;
        log.warn({ diagnosis }, "la IP fijada hace que el sitio rechace a Chromium; se reintenta con el DNS normal");
        result = await run(undefined);
        diagnosis = "";
      }
      const { lhr, extracted } = result;

      const key = buildAuditKey({
        clientSlug: ctx.clientSlug,
        projectSlug: ctx.project.slug,
        routePath: ctx.route.path,
        profile: ctx.audit.profile,
        auditId,
        at: now(),
      });
      const { bytes } = await deps.r2.putAuditJson(key, lhr);
      // Lo que hay que mejorar, ya en español, para que el portal no abra el JSON completo en cada vista. Si falla, no es motivo
      // para perder la auditoría: se calculará al pedirlo.
      let improvements = null;
      try {
        improvements = extractImprovements(localizeLhr(lhr as LhrLike & Record<string, unknown>, "es"));
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "no se pudo extraer lo que hay que mejorar");
      }
      await repo.markSucceeded(deps.db, auditId, extracted.metrics, key, improvements);
      log.info(
        { key, bytes, performance: extracted.metrics.scorePerformance, seo: extracted.metrics.scoreSeo },
        "auditoría correcta",
      );
      await evaluate("success", auditId, log);
    } catch (err) {
      const failure = withNote(classifyError(err), diagnosis);
      const isLast = !failure.retryable || attempt >= maxAttempts;
      if (isLast) {
        await repo.markFailed(deps.db, auditId, failure);
        log.warn({ code: failure.code, attempt }, `auditoría fallida: ${failure.message}`);
        await evaluate("failure", auditId, log);
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
