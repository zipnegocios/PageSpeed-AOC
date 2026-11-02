import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { alertThresholds, projects } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { requireSlug } from "@/server/domain/slug";
import { normalizeHost, parseHttpUrl } from "@/server/domain/url-guard";
import * as repo from "@/server/repositories/projects";
import { findClient } from "@/server/repositories/clients";
import { phaseInput, projectInput, projectUpdateInput } from "@/server/validation/projects";
import { assertUuid, isUniqueViolation, parseInput, uniqueSlug } from "./shared";
import { getDefaultThresholds, METRICS } from "./settings";

export type { Project, ProjectWithClient } from "@/server/repositories/projects";

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

/**
 * Crea el proyecto con sus 4 umbrales iniciales. Empieza en desarrollo salvo que se indique
 * producción (cliente que llega con el sitio ya publicado).
 */
export async function createProject(clientId: string, raw: unknown, db: Database = getDb()) {
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

  try {
    return await db.transaction(async (tx) => {
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
}

export async function updateProject(id: string, raw: unknown, db: Database = getDb()) {
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
  return updated;
}

/**
 * Cambia la fase. Pasar a desarrollo silencia las alertas abiertas (no se notifican ni
 * recuerdan). El agendado de auditorías se conecta en el milestone del worker.
 */
export async function setProjectPhase(id: string, rawPhase: unknown, db: Database = getDb()) {
  assertUuid(id, "Proyecto");
  const phase = parseInput(phaseInput, rawPhase);
  const current = await getProject(id, db);
  if (current.phase === phase) return { project: current, suppressedAlerts: 0 };

  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .update(projects)
      .set({ phase, phaseChangedAt: new Date() })
      .where(and(eq(projects.id, id)))
      .returning();
    return project;
  });
  const suppressedAlerts = phase === "development" ? await repo.suppressOpenAlerts(db, id) : 0;
  return { project: { ...current, ...result! }, suppressedAlerts };
}

export async function archiveProject(id: string, db: Database = getDb()) {
  assertUuid(id, "Proyecto");
  const updated = await repo.updateProject(db, id, { deletedAt: new Date() });
  if (!updated) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
}
