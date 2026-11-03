import type { Queue } from "bullmq";
import type { Logger } from "pino";
import type { Database } from "@/server/db/client";
import { auditJobOptions, PRIORITY, type AuditJobData } from "@/server/queue/queues";
import { syncProjectSchedulers } from "@/server/queue/schedulers";
import * as repo from "@/server/repositories/audits";
import { listProductionProjects } from "@/server/repositories/projects";

export type ReconcileDeps = {
  db: Database;
  lighthouse: Queue<AuditJobData>;
  maintenance: Queue;
  log: Logger;
  /** Plazo máximo de una auditoría: una "en curso" más vieja que esto + margen no es legítima. */
  timeoutMs: number;
  now?: () => Date;
  /** Una solicitud recién creada puede tardar un instante en tener su trabajo en la cola. */
  minQueuedAgeMs?: number;
};

export type ReconcileReport = {
  /** "En curso" huérfanas cuyo trabajo seguía pendiente: vuelven a "en cola". */
  requeued: number;
  /** "En curso" huérfanas sin trabajo: se marcan como falladas (WORKER_LOST). */
  lost: number;
  /** "En cola" sin trabajo en Redis: se vuelve a encolar. */
  reenqueued: number;
  schedulers: { created: number; updated: number; removed: number; unchanged: number };
};

const PENDING_STATES = new Set(["waiting", "prioritized", "delayed", "waiting-children"]);

/**
 * Postgres es la fuente de verdad y Redis es transitorio: si el worker se cae a mitad de una
 * auditoría, o Redis pierde datos, aquí se corrige el desfase y se resincronizan los agendadores.
 * Es idempotente: ejecutarlo dos veces seguidas no cambia nada la segunda vez.
 */
export async function reconcile(deps: ReconcileDeps): Promise<ReconcileReport> {
  const now = (deps.now ?? (() => new Date()))();
  const report: ReconcileReport = {
    requeued: 0,
    lost: 0,
    reenqueued: 0,
    schedulers: { created: 0, updated: 0, removed: 0, unchanged: 0 },
  };

  // 1) "En curso" que ya no puede estar corriendo.
  const staleBefore = new Date(now.getTime() - (deps.timeoutMs + 5 * 60_000));
  for (const audit of await repo.listStaleRunning(deps.db, staleBefore)) {
    const job = await deps.lighthouse.getJob(audit.id);
    const state = job ? await job.getState() : "unknown";
    if (state === "active") continue; // sigue viva: BullMQ renueva su bloqueo
    if (PENDING_STATES.has(state)) {
      await repo.markRequeued(deps.db, audit.id);
      report.requeued++;
    } else {
      await repo.markFailed(deps.db, audit.id, {
        code: "WORKER_LOST",
        message: "El worker se detuvo durante la auditoría.",
      });
      report.lost++;
    }
  }

  // 2) "En cola" sin trabajo en Redis.
  const queuedBefore = new Date(now.getTime() - (deps.minQueuedAgeMs ?? 2 * 60_000));
  for (const audit of await repo.listQueuedBefore(deps.db, queuedBefore)) {
    const job = await deps.lighthouse.getJob(audit.id);
    const state = job ? await job.getState() : "unknown";
    if (job && (PENDING_STATES.has(state) || state === "active")) continue;
    if (job && state === "failed") {
      // El trabajo agotó sus intentos pero la fila no llegó a actualizarse.
      await repo.markFailed(deps.db, audit.id, { code: "WORKER_LOST", message: "La auditoría se interrumpió." });
      report.lost++;
      continue;
    }
    if (job) await job.remove().catch(() => undefined); // completado sin cerrar la fila: se rehace
    await deps.lighthouse.add(
      "audit",
      { auditId: audit.id },
      auditJobOptions(audit.id, audit.trigger === "scheduled" ? PRIORITY.scheduled : PRIORITY.manual),
    );
    report.reenqueued++;
  }

  // 3) Agendadores de Redis = proyectos en producción de Postgres.
  report.schedulers = await syncProjectSchedulers(deps.maintenance, await listProductionProjects(deps.db));

  const changed = report.requeued + report.lost + report.reenqueued + report.schedulers.created + report.schedulers.updated + report.schedulers.removed;
  deps.log[changed > 0 ? "warn" : "debug"](report, changed > 0 ? "reconciliación: se corrigieron desfases" : "reconciliación: todo en orden");
  return report;
}
