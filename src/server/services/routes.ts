import { getDb, type Database } from "@/server/db/client";
import { routes } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { normalizePath, routeUrl } from "@/server/domain/route-path";
import { assertHostAllowed, parseHttpUrl } from "@/server/domain/url-guard";
import * as repo from "@/server/repositories/routes";
import { findProject } from "@/server/repositories/projects";
import { routeInput } from "@/server/validation/projects";
import { assertUuid, isUniqueViolation, parseInput } from "./shared";

export type { Route } from "@/server/repositories/routes";

export function listRoutes(projectId: string, db: Database = getDb()) {
  assertUuid(projectId, "Proyecto");
  return repo.listRoutes(db, projectId);
}

async function requireProject(projectId: string, db: Database) {
  assertUuid(projectId, "Proyecto");
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  return project;
}

/** Acepta "/contacto" o una URL completa; en ese caso su host debe estar permitido. */
export async function addRoute(projectId: string, raw: unknown, db: Database = getDb()) {
  const project = await requireProject(projectId, db);
  const input = parseInput(routeInput, raw);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input.path)) assertHostAllowed(parseHttpUrl(input.path), project.allowedHosts);
  const path = normalizePath(input.path);
  if (await repo.findRouteByPath(db, projectId, path)) {
    throw new DomainError("CONFLICT", `La ruta ${path} ya existe en este proyecto.`);
  }
  try {
    const [row] = await db
      .insert(routes)
      .values({
        projectId,
        path,
        url: routeUrl(project.baseUrl, path),
        label: input.label ?? null,
        source: "manual",
        monitored: true,
        requiresAuth: input.requiresAuth,
      })
      .returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("CONFLICT", `La ruta ${path} ya existe en este proyecto.`);
    throw err;
  }
}

export async function setRouteMonitored(routeId: string, monitored: boolean, db: Database = getDb()) {
  assertUuid(routeId, "Ruta");
  const updated = await repo.updateRoute(db, routeId, { monitored });
  if (!updated) throw new DomainError("NOT_FOUND", "Ruta no encontrada.");
  return updated;
}

export async function updateRouteDetails(
  routeId: string,
  values: { label?: string | null; requiresAuth?: boolean },
  db: Database = getDb(),
) {
  assertUuid(routeId, "Ruta");
  const updated = await repo.updateRoute(db, routeId, {
    ...(values.label !== undefined ? { label: values.label?.trim() || null } : {}),
    ...(values.requiresAuth !== undefined ? { requiresAuth: values.requiresAuth } : {}),
  });
  if (!updated) throw new DomainError("NOT_FOUND", "Ruta no encontrada.");
  return updated;
}

/** Una ruta con historial no se borra: se desactiva para conservar las auditorías. */
export async function removeRoute(routeId: string, db: Database = getDb()) {
  assertUuid(routeId, "Ruta");
  const route = await repo.findRoute(db, routeId);
  if (!route) throw new DomainError("NOT_FOUND", "Ruta no encontrada.");
  if ((await repo.countRouteAudits(db, routeId)) > 0) {
    throw new DomainError("CONFLICT", "Esta ruta tiene historial de auditorías. Desactívala en lugar de borrarla.");
  }
  await repo.deleteRoute(db, routeId);
}
