import { DomainError } from "@/server/domain/errors";
import { canAccessProject, type KeyAccess } from "@/server/domain/mcp-access";
import { getProject } from "@/server/services/projects";
import { getRoute } from "@/server/services/routes";

/**
 * Comprobaciones de alcance de una clave sobre los datos. Lo que queda fuera se responde igual que algo que no existe
 * («… no encontrado»), para que una clave limitada no pueda averiguar qué clientes o proyectos hay más allá de los suyos.
 */

/** El proyecto debe estar dentro del alcance de la clave. */
export async function requireProject(access: KeyAccess, projectId: string): Promise<void> {
  if (access.all) return;
  const project = await getProject(projectId);
  if (!canAccessProject(access, project)) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
}

/** La ruta debe pertenecer a un proyecto dentro del alcance de la clave. Devuelve la ruta. */
export async function requireRoute(access: KeyAccess, routeId: string) {
  const route = await getRoute(routeId);
  if (!access.all) {
    try {
      await requireProject(access, route.projectId);
    } catch {
      throw new DomainError("NOT_FOUND", "Ruta no encontrada.");
    }
  }
  return route;
}

/** La auditoría (ya leída) debe ser de un proyecto dentro del alcance de la clave. */
export async function requireAudit(access: KeyAccess, audit: { projectId: string }): Promise<void> {
  if (access.all) return;
  try {
    await requireProject(access, audit.projectId);
  } catch {
    throw new DomainError("NOT_FOUND", "Auditoría no encontrada.");
  }
}
