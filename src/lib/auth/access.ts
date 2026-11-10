import "server-only";
import { cache } from "react";
import { getDb } from "@/server/db/client";
import type { ClientLevel, Scope } from "@/server/domain/access";
import { isDomainError } from "@/server/domain/errors";
import { assertOwner } from "@/server/domain/team";
import {
  getClientLevel,
  assertAuditAccess,
  assertClientAccess,
  assertManageArchivedClient,
  assertManageArchivedProject,
  assertManageClient,
  assertManageProject,
  assertProjectAccess,
  assertRouteAccess,
  loadScope,
} from "@/server/services/access";
import type { AdminSummary } from "@/server/services/admin-auth";
import { assertKeyAccess } from "@/server/services/api-keys";
import { getSession, verifySession } from "./session";

/**
 * Guardas de acceso para páginas, acciones y rutas de administración: abren la sesión (o mandan a /login) y comprueban que la persona
 * ve —o puede gestionar— lo que pide. Lanzan `DomainError("NOT_FOUND")`: las páginas lo vuelven 404 (`orNotFound`) y las acciones lo
 * devuelven como mensaje (`guarded`). Úsalas **dentro** de `guarded(...)` en las acciones. Un test estático exige que cada acción y
 * cada ruta de administración que recibe un id llame a una de estas.
 */

/** Alcance de la persona para filtrar listados (`undefined` en las consultas del sistema significa «sin filtro»). */
export const requireScope = cache(async (): Promise<{ session: AdminSummary; scope: Scope }> => {
  const session = await verifySession();
  return { session, scope: await loadScope(getDb(), session) };
});

/** Cómo ve la persona un cliente («full», «projects-only» o null si no lo ve): para que la ficha decida qué muestra. */
export async function clientLevelOf(clientId: string): Promise<ClientLevel | null> {
  const session = await verifySession();
  return getClientLevel(getDb(), session, clientId);
}

export async function requireProjectAccess(projectId: string): Promise<AdminSummary> {
  const session = await verifySession();
  await assertProjectAccess(getDb(), session, projectId);
  return session;
}

export async function requireClientAccess(clientId: string, level: "any" | "full" = "full"): Promise<AdminSummary> {
  const session = await verifySession();
  await assertClientAccess(getDb(), session, clientId, level);
  return session;
}

export async function requireManageClient(clientId: string): Promise<AdminSummary> {
  const session = await verifySession();
  await assertManageClient(getDb(), session, clientId);
  return session;
}

export async function requireManageProject(projectId: string): Promise<AdminSummary> {
  const session = await verifySession();
  await assertManageProject(getDb(), session, projectId);
  return session;
}

/** La ruta se resuelve a su proyecto real: el id de proyecto que llega en la petición no se usa para decidir. */
export async function requireRouteAccess(routeId: string): Promise<AdminSummary> {
  const session = await verifySession();
  await assertRouteAccess(getDb(), session, routeId);
  return session;
}

export async function requireAuditAccess(auditId: string): Promise<AdminSummary> {
  const session = await verifySession();
  await assertAuditAccess(getDb(), session, auditId);
  return session;
}

export async function requireManageArchivedClient(clientId: string): Promise<AdminSummary> {
  const session = await verifySession();
  await assertManageArchivedClient(getDb(), session, clientId);
  return session;
}

export async function requireManageArchivedProject(projectId: string): Promise<AdminSummary> {
  const session = await verifySession();
  await assertManageArchivedProject(getDb(), session, projectId);
  return session;
}

/** La clave de agente, solo si es de la persona (o si es el propietario). */
export async function requireKeyAccess(keyId: string): Promise<AdminSummary> {
  const session = await verifySession();
  await assertKeyAccess(getDb(), session, keyId);
  return session;
}

/** Lo que es del sistema entero (cuenta de Google, respaldos, equipo): solo el propietario. */
export async function requireOwner(): Promise<AdminSummary> {
  const session = await verifySession();
  assertOwner(session);
  return session;
}

/**
 * Para las rutas `/api/admin/**`: 401 sin sesión, 404 si la persona no ve lo que pide (igual que si no existiera). Devuelve la sesión o
 * la respuesta de error ya armada.
 */
export async function apiGuard(check: (session: AdminSummary) => Promise<unknown>): Promise<AdminSummary | Response> {
  const session = await getSession();
  if (!session) return new Response("No autorizado", { status: 401 });
  try {
    await check(session);
  } catch (err) {
    // Cualquier error de negocio (id mal formado, no existe, no lo ve) responde igual: no se revela qué hay.
    if (isDomainError(err)) return new Response("No encontrado", { status: 404 });
    throw err;
  }
  return session;
}

export const apiProjectAccess = (projectId: string) => apiGuard((session) => assertProjectAccess(getDb(), session, projectId));
export const apiAuditAccess = (auditId: string) => apiGuard((session) => assertAuditAccess(getDb(), session, auditId));
export const apiClientAccess = (clientId: string, level: "any" | "full" = "any") => apiGuard((session) => assertClientAccess(getDb(), session, clientId, level));

export type { ClientLevel };
