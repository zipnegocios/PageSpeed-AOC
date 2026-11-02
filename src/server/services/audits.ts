import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { getDb, type Database } from "@/server/db/client";
import { assertRouteAuditable, planProfiles, type AuditTrigger, type Profile } from "@/server/domain/audit-rules";
import { DomainError } from "@/server/domain/errors";
import { readHeartbeat } from "@/server/queue/heartbeat";
import { getRedis } from "@/server/queue/connection";
import { auditJobOptions, lighthouseQueue, PRIORITY, type AuditJobData } from "@/server/queue/queues";
import * as repo from "@/server/repositories/audits";
import { findProject } from "@/server/repositories/projects";
import { findRoute } from "@/server/repositories/routes";
import { assertUuid, isUniqueViolation } from "./shared";

export type { AuditDetail, AuditLog, AuditWithRoute } from "@/server/repositories/audits";

/** Máximo de trabajos esperando antes de rechazar nuevas solicitudes manuales. */
export const MAX_WAITING_JOBS = 50;

export type RequestAuditInput = {
  routeId: string;
  /** Desarrollo: exactamente uno. Producción: uno o ambos (por defecto ambos). */
  profiles?: Profile[];
  trigger: AuditTrigger;
  requestedBy: string;
};

export type RequestAuditDeps = {
  db?: Database;
  queue?: Queue<AuditJobData>;
  redis?: Redis;
};

export type RequestAuditResult = { audits: repo.AuditLog[]; created: number; alreadyPending: number };

/**
 * Solicita auditorías de una ruta: valida la fase, inserta la fila en audit_logs y encola.
 * Es idempotente: si ya hay una auditoría pendiente de esa ruta y perfil, devuelve esa.
 */
export async function requestAudit(input: RequestAuditInput, deps: RequestAuditDeps = {}): Promise<RequestAuditResult> {
  const db = deps.db ?? getDb();
  assertUuid(input.routeId, "Ruta");

  const route = await findRoute(db, input.routeId);
  if (!route) throw new DomainError("NOT_FOUND", "Ruta no encontrada.");
  const project = await findProject(db, route.projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");

  const profiles = planProfiles(project.phase, input.profiles, input.trigger);
  assertRouteAuditable(route.url, project.allowedHosts);

  const redis = deps.redis ?? getRedis();
  const queue = deps.queue ?? lighthouseQueue(redis);

  // Las programadas las crea el propio worker; las manuales exigen un worker en línea.
  if (input.trigger !== "scheduled") {
    if (!(await readHeartbeat(redis))) {
      throw new DomainError(
        "UPSTREAM",
        "El worker de auditorías no está en línea. Inicia el servicio worker e inténtalo de nuevo.",
      );
    }
    const counts = await queue.getJobCounts("waiting", "prioritized", "delayed");
    const waiting = (counts.waiting ?? 0) + (counts.prioritized ?? 0) + (counts.delayed ?? 0);
    if (waiting >= MAX_WAITING_JOBS) {
      throw new DomainError("CONFLICT", "La cola de auditorías está llena. Espera a que avance e inténtalo de nuevo.");
    }
  }

  const priority =
    input.trigger === "scheduled"
      ? project.auditFrequency === "daily"
        ? PRIORITY.scheduledDaily
        : PRIORITY.scheduled
      : PRIORITY.manual;

  const audits: repo.AuditLog[] = [];
  let created = 0;
  let alreadyPending = 0;

  for (const profile of profiles) {
    let audit: repo.AuditLog;
    try {
      audit = await repo.insertAudit(db, {
        projectId: project.id,
        routeId: route.id,
        profile,
        trigger: input.trigger,
        requestedBy: input.requestedBy,
        phaseAtRun: project.phase,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const pending = await repo.findPending(db, route.id, profile);
      if (!pending) throw err;
      audits.push(pending);
      alreadyPending++;
      continue;
    }

    try {
      await queue.add("audit", { auditId: audit.id }, auditJobOptions(audit.id, priority));
    } catch {
      // Sin trabajo en la cola, la fila pendiente bloquearía la ruta para siempre.
      await repo.markFailed(db, audit.id, { code: "QUEUE_UNAVAILABLE", message: "No se pudo encolar la auditoría." });
      throw new DomainError("UPSTREAM", "No se pudo encolar la auditoría (Redis no responde). Inténtalo de nuevo.");
    }
    audits.push(audit);
    created++;
  }
  return { audits, created, alreadyPending };
}

export async function listAudits(projectId: string, limit = 20, db: Database = getDb()) {
  assertUuid(projectId, "Proyecto");
  return repo.listRecentAudits(db, projectId, Math.min(Math.max(limit, 1), 100));
}

export async function getAudit(id: string, db: Database = getDb()) {
  assertUuid(id, "Auditoría");
  const audit = await repo.findAuditDetail(db, id);
  if (!audit) throw new DomainError("NOT_FOUND", "Auditoría no encontrada.");
  return audit;
}
