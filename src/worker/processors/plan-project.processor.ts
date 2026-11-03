import type { Job, Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Database } from "@/server/db/client";
import type { AuditJobData } from "@/server/queue/queues";
import { removeProjectScheduler, type PlanJobData } from "@/server/queue/schedulers";
import { findProject } from "@/server/repositories/projects";
import { listRoutes } from "@/server/repositories/routes";
import { requestAudit } from "@/server/services/audits";

export type PlanProjectDeps = {
  db: Database;
  redis: Redis;
  lighthouse: Queue<AuditJobData>;
  maintenance: Queue;
  log: Logger;
};

/**
 * Se ejecuta cuando el cron de un proyecto se dispara: pide la auditoría (móvil y escritorio) de
 * cada ruta monitoreada. Relee el proyecto en cada disparo, así que si ya no está en producción o
 * fue archivado, retira su agendador en lugar de auditar.
 */
export function createPlanProjectProcessor(deps: PlanProjectDeps) {
  return async function planProjectAudit(job: Job<PlanJobData>): Promise<void> {
    const { projectId } = job.data;
    const log = deps.log.child({ projectId, jobId: job.id });
    const project = await findProject(deps.db, projectId);

    if (!project || project.phase !== "production") {
      await removeProjectScheduler(deps.maintenance, projectId);
      log.info({ phase: project?.phase ?? "inexistente" }, "agendador retirado: el proyecto ya no está en producción");
      return;
    }

    const routes = (await listRoutes(deps.db, projectId)).filter((r) => r.monitored);
    let created = 0;
    let alreadyPending = 0;
    let failed = 0;
    for (const route of routes) {
      try {
        const result = await requestAudit(
          { routeId: route.id, trigger: "scheduled", requestedBy: "agendador" },
          { db: deps.db, queue: deps.lighthouse, redis: deps.redis },
        );
        created += result.created;
        alreadyPending += result.alreadyPending;
      } catch (err) {
        // Una ruta con problemas no impide auditar las demás.
        failed++;
        log.warn({ routeId: route.id, err: err instanceof Error ? err.message : String(err) }, "no se pudo programar una ruta");
      }
    }
    log.info({ routes: routes.length, created, alreadyPending, failed }, "auditorías programadas encoladas");
  };
}
