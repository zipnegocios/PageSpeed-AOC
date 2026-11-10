import type { Scope } from "@/server/domain/access";
import { and, eq } from "drizzle-orm";
import type { Queue } from "bullmq";
import { getDb, type Database } from "@/server/db/client";
import { alertThresholds, projects } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { requireSlug } from "@/server/domain/slug";
import { normalizeHost, parseHttpUrl } from "@/server/domain/url-guard";
import * as repo from "@/server/repositories/projects";
import { findClient, findClientBySlug } from "@/server/repositories/clients";
import { maintenanceQueue } from "@/server/queue/queues";
import { getProjectNextRun, removeProjectScheduler, upsertProjectScheduler } from "@/server/queue/schedulers";
import { cancelScheduledAudits } from "./audits";
import { phaseInput, projectInput, projectUpdateInput } from "@/server/validation/projects";
import { assertUuid, isUniqueViolation, isUuid, parseInput, uniqueSlug } from "./shared";
import { getDefaultThresholds, METRICS } from "./settings";

export type { Project, ProjectWithClient } from "@/server/repositories/projects";

/** Colas inyectables para pruebas; por defecto, las de Redis. */
export type SchedulerDeps = { maintenance?: Queue; lighthouse?: Queue };

export type SchedulerOutcome = {
  /** false si Redis no respondió: el agendado se corrige solo al reconciliar el worker. */
  ok: boolean;
  /** Auditorías programadas pendientes que se retiraron. */
  cancelled: number;
};

/**
 * Deja el agendador del proyecto como corresponde a su estado: registrado si está en producción,
 * retirado (y sus auditorías programadas pendientes canceladas) si no. Es de mejor esfuerzo: un
 * fallo de Redis nunca impide guardar el cambio del proyecto.
 */
export async function applyScheduler(
  project: { id: string; phase: "development" | "production"; auditFrequency: "weekly" | "daily"; deletedAt?: Date | null },
  db: Database,
  deps: SchedulerDeps,
): Promise<SchedulerOutcome> {
  try {
    const maintenance = deps.maintenance ?? maintenanceQueue();
    if (project.phase === "production" && !project.deletedAt) {
      await upsertProjectScheduler(maintenance, project);
      return { ok: true, cancelled: 0 };
    }
    await removeProjectScheduler(maintenance, project.id);
    const cancelled = await cancelScheduledAudits(project.id, { db, queue: deps.lighthouse as never });
    return { ok: true, cancelled };
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error("[agendador] no se pudo actualizar:", err instanceof Error ? err.message : err);
    }
    return { ok: false, cancelled: 0 };
  }
}

const HOST_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Deja solo el origen (esquema + host + puerto): las rutas se guardan aparte. */
export function normalizeBaseUrl(input: string): string {
  return parseHttpUrl(input).origin;
}

/**
 * Lista de hosts permitidos desde texto libre. Se separa solo por líneas o comas (nunca por
 * espacios): así un error como "host con espacios" se rechaza en lugar de aceptarse en silencio.
 */
export function parseAllowedHosts(text: string | undefined, baseUrl: string): string[] {
  const hosts = new Set<string>([normalizeHost(new URL(baseUrl).hostname)]);
  for (const raw of (text ?? "").split(/[\n,;]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const host = normalizeHost(entry.replace(/^https?:\/\//i, "").split("/")[0]!.split(":")[0]!);
    if (!HOST_RE.test(host) || host.length > 253) {
      throw new DomainError("INVALID", `"${entry}" no es un host válido. Usa por ejemplo www.ejemplo.com o *.ejemplo.com.`);
    }
    hosts.add(host);
  }
  return [...hosts];
}

export function listAllProjects(db: Database = getDb(), scope?: Scope) {
  return repo.listAllProjects(db, scope);
}

export function listProjects(clientId: string, db: Database = getDb()) {
  assertUuid(clientId, "Cliente");
  return repo.listProjectsForClient(db, clientId);
}

export async function getProject(id: string, db: Database = getDb()) {
  assertUuid(id, "Proyecto");
  const project = await repo.findProject(db, id);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  return project;
}

/** Cambia el identificador del proyecto; el anterior sigue resolviendo y queda reservado dentro del cliente. */
export async function renameProjectSlug(id: string, rawSlug: string, db: Database = getDb()) {
  assertUuid(id, "Proyecto");
  const slug = requireSlug((rawSlug ?? "").trim());
  const current = await repo.findProject(db, id);
  if (!current) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  if (slug === current.slug) return current;
  if (!current.slugAliases.includes(slug) && (await repo.projectSlugTaken(db, current.clientId, slug))) {
    throw new DomainError("CONFLICT", `Este cliente ya tiene un proyecto con el identificador "${slug}" (o lo tuvo).`);
  }
  try {
    const updated = await repo.setProjectSlug(db, id, slug, current.slug);
    if (!updated) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("CONFLICT", `Este cliente ya tiene un proyecto con el identificador "${slug}".`);
    throw err;
  }
}

/** Proyecto por (cliente, proyecto) en slug o, para enlaces antiguos, en UUID. El proyecto debe ser de ese cliente. */
export async function getProjectByRef(clientRef: string, projectRef: string, db: Database = getDb()) {
  const client = isUuid(clientRef) ? await findClient(db, clientRef) : await findClientBySlug(db, clientRef);
  const project = client ? (isUuid(projectRef) ? await repo.findProject(db, projectRef) : await repo.findProjectBySlug(db, client.id, projectRef)) : undefined;
  if (!client || !project || project.clientId !== client.id) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  return project;
}

/**
 * Crea el proyecto con sus 4 umbrales iniciales. Empieza en desarrollo salvo que se indique
 * producción (cliente que llega con el sitio ya publicado).
 */
export async function createProject(clientId: string, raw: unknown, db: Database = getDb(), deps: SchedulerDeps = {}) {
  assertUuid(clientId, "Cliente");
  const input = parseInput(projectInput, raw);
  if (!(await findClient(db, clientId))) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const slug = input.slug
    ? requireSlug(input.slug)
    : await uniqueSlug(input.name, (s) => repo.projectSlugTaken(db, clientId, s));
  if (input.slug && (await repo.projectSlugTaken(db, clientId, slug))) {
    throw new DomainError("CONFLICT", `Este cliente ya tiene un proyecto con el identificador "${slug}".`);
  }
  const defaults = await getDefaultThresholds(db);

  let created: typeof projects.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          clientId,
          name: input.name,
          slug,
          baseUrl,
          allowedHosts: parseAllowedHosts(undefined, baseUrl),
          phase: input.phase,
          auditFrequency: input.auditFrequency,
          sitemapUrl: input.sitemapUrl ? parseHttpUrl(input.sitemapUrl).toString() : null,
        })
        .returning();
      if (!project) throw new Error("No se pudo crear el proyecto");
      await tx
        .insert(alertThresholds)
        .values(METRICS.map((metric) => ({ projectId: project.id, metric, minScore: defaults[metric] })));
      return project;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError("CONFLICT", `Este cliente ya tiene un proyecto con el identificador "${slug}".`);
    }
    throw err;
  }
  // Un proyecto que nace en producción (sitio ya publicado) empieza a auditarse según su frecuencia.
  if (created.phase === "production") await applyScheduler(created, db, deps);
  return created;
}

export async function updateProject(id: string, raw: unknown, db: Database = getDb(), deps: SchedulerDeps = {}) {
  assertUuid(id, "Proyecto");
  const input = parseInput(projectUpdateInput, raw);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const updated = await repo.updateProject(db, id, {
    name: input.name,
    baseUrl,
    auditFrequency: input.auditFrequency,
    sitemapUrl: input.sitemapUrl ? parseHttpUrl(input.sitemapUrl).toString() : null,
    allowedHosts: parseAllowedHosts(input.allowedHosts, baseUrl),
  });
  if (!updated) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  // Un cambio de frecuencia mueve el cron del proyecto en producción.
  if (updated.phase === "production") await applyScheduler(updated, db, deps);
  return updated;
}

/**
 * Cambia la fase. Pasar a producción registra el agendador del proyecto; pasar a desarrollo lo
 * retira, cancela las auditorías programadas que aún no empezaron y silencia las alertas abiertas
 * (no se notifican ni recuerdan).
 */
export async function setProjectPhase(id: string, rawPhase: unknown, db: Database = getDb(), deps: SchedulerDeps = {}) {
  assertUuid(id, "Proyecto");
  const phase = parseInput(phaseInput, rawPhase);
  const current = await getProject(id, db);
  if (current.phase === phase) {
    return { project: current, suppressedAlerts: 0, scheduler: { ok: true, cancelled: 0 } as SchedulerOutcome };
  }

  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .update(projects)
      .set({ phase, phaseChangedAt: new Date() })
      .where(and(eq(projects.id, id)))
      .returning();
    return project;
  });
  const suppressedAlerts = phase === "development" ? await repo.suppressOpenAlerts(db, id) : 0;
  const project = { ...current, ...result! };
  const scheduler = await applyScheduler(project, db, deps);
  return { project, suppressedAlerts, scheduler };
}

export async function archiveProject(id: string, db: Database = getDb(), deps: SchedulerDeps = {}) {
  assertUuid(id, "Proyecto");
  const updated = await repo.updateProject(db, id, { deletedAt: new Date() });
  if (!updated) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  // Un proyecto archivado deja de auditarse.
  await applyScheduler(updated, db, deps);
}

/** Próxima ejecución programada del proyecto, o null si no está agendado o Redis no responde. */
export async function getNextScheduledRun(projectId: string, deps: SchedulerDeps = {}): Promise<Date | null> {
  assertUuid(projectId, "Proyecto");
  try {
    return await getProjectNextRun(deps.maintenance ?? maintenanceQueue(), projectId);
  } catch {
    return null;
  }
}

/** «En mejora inicial»: los valores son el punto de partida. Lo explican el portal, los PDF y el correo mensual hasta que se apague. */
export async function setProjectInitialImprovement(id: string, on: boolean, db: Database = getDb()): Promise<void> {
  assertUuid(id, "Proyecto");
  if (!(await repo.setInitialImprovement(db, id, on))) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
}
