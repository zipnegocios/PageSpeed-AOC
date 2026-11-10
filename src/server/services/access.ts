import type { Database } from "@/server/db/client";
import { buildScope, canManage, canViewProject, clientLevel, type Actor, type Scope } from "@/server/domain/access";
import { DomainError } from "@/server/domain/errors";
import * as archive from "@/server/repositories/archive";
import * as audits from "@/server/repositories/audits";
import * as clientsRepo from "@/server/repositories/clients";
import * as projectsRepo from "@/server/repositories/projects";
import * as routesRepo from "@/server/repositories/routes";
import * as shares from "@/server/repositories/team-shares";
import { assertUuid } from "./shared";

/**
 * El control de acceso del equipo: qué clientes y proyectos ve cada persona y quién puede gestionarlos (compartir, reasignar,
 * archivar). Las guardas lanzan `NOT_FOUND` también cuando existe pero la persona no lo ve: no se revela qué hay. Los servicios de
 * datos no reciben a la persona; el control vive aquí y en los listados con `scope`.
 */

const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} no encontrado.`);

/** El alcance actual de una persona: dos consultas (sus compartidos y sus clientes), nunca una por proyecto. El propietario no consulta nada. */
export async function loadScope(db: Database, actor: Actor): Promise<Scope> {
  if (actor.role === "owner") return buildScope(actor, { shares: [], ownClientIds: [] });
  const [sharesRows, ownClientIds] = await Promise.all([shares.listSharesForAdmin(db, actor.id), shares.listOwnClientIds(db, actor.id)]);
  return buildScope(actor, { shares: sharesRows, ownClientIds });
}

/** El proyecto, solo si la persona lo ve. */
export async function assertProjectAccess(db: Database, actor: Actor, projectId: string) {
  assertUuid(projectId, "Proyecto");
  const project = await projectsRepo.findProject(db, projectId);
  if (!project) throw notFound("Proyecto");
  if (actor.role !== "owner" && !canViewProject(await loadScope(db, actor), project)) throw notFound("Proyecto");
  return project;
}

/** El cliente, solo si la persona lo ve. `level: "full"` exige verlo entero (no solo algún proyecto suyo). */
export async function assertClientAccess(db: Database, actor: Actor, clientId: string, level: "any" | "full" = "full") {
  assertUuid(clientId, "Cliente");
  const client = await clientsRepo.findClient(db, clientId);
  if (!client) throw notFound("Cliente");
  if (actor.role === "owner") return client;
  const scope = await loadScope(db, actor);
  const projects = scope.all ? [] : (await projectsRepo.listProjectsForClient(db, clientId)).map((p) => p.id);
  const have = clientLevel(scope, clientId, projects);
  if (have === null || (level === "full" && have !== "full")) throw notFound("Cliente");
  return client;
}

/** El cliente, solo si la persona puede gestionarlo (propietario o responsable): compartir, reasignar, archivar, suspender. */
export async function assertManageClient(db: Database, actor: Actor, clientId: string) {
  assertUuid(clientId, "Cliente");
  const client = await clientsRepo.findClient(db, clientId);
  if (!client || !canManage(actor, client)) throw notFound("Cliente");
  return client;
}

/** El proyecto, solo si la persona puede gestionar su cliente. */
export async function assertManageProject(db: Database, actor: Actor, projectId: string) {
  const project = await assertProjectAccess(db, actor, projectId);
  await assertManageClient(db, actor, project.clientId);
  return project;
}

/** La ruta, solo si la persona ve su proyecto. Devuelve la ruta y el proyecto real (el que viene en la petición no es de fiar). */
export async function assertRouteAccess(db: Database, actor: Actor, routeId: string) {
  assertUuid(routeId, "Ruta");
  const route = await routesRepo.findRoute(db, routeId);
  if (!route) throw notFound("Ruta");
  const project = await assertProjectAccess(db, actor, route.projectId);
  return { route, project };
}

/** La auditoría, solo si la persona ve su proyecto. */
export async function assertAuditAccess(db: Database, actor: Actor, auditId: string) {
  assertUuid(auditId, "Auditoría");
  const audit = await audits.findAuditContext(db, auditId);
  if (!audit) throw notFound("Auditoría");
  await assertProjectAccess(db, actor, audit.project.id);
  return audit;
}

/** Un cliente archivado, solo si la persona puede gestionarlo (restaurar y borrar son de gestión). */
export async function assertManageArchivedClient(db: Database, actor: Actor, clientId: string) {
  assertUuid(clientId, "Cliente");
  const client = await archive.findArchivedClient(db, clientId);
  if (!client || !canManage(actor, client)) throw notFound("Cliente");
  return client;
}

/** Un proyecto archivado, solo si la persona puede gestionar su cliente. */
export async function assertManageArchivedProject(db: Database, actor: Actor, projectId: string) {
  assertUuid(projectId, "Proyecto");
  const found = await archive.findArchivedProject(db, projectId);
  if (!found) throw notFound("Proyecto");
  const client = await clientsRepo.findClientIncludingArchived(db, found.project.clientId);
  if (!client || !canManage(actor, client)) throw notFound("Proyecto");
  return found;
}
