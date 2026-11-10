/**
 * Alcance de una clave de agente sobre los datos: todos los clientes y proyectos, o solo una lista.
 * Un proyecto es accesible si está en la lista de proyectos o si su cliente está en la de clientes
 * (por eso un proyecto nuevo de un cliente permitido entra solo).
 */
export type KeyAccess = { all: true } | { all: false; clientIds: string[]; projectIds: string[]; /** Recorte adicional: el proyecto también debe estar permitido por este alcance (el de quien creó la clave). */ limit?: KeyAccess };

export const ACCESS_ALL: KeyAccess = { all: true };

/** ¿Puede esta clave ver/tocar el proyecto `projectId` del cliente `clientId`? */
export function canAccessProject(access: KeyAccess, project: { id: string; clientId: string }): boolean {
  if (access.all) return true;
  if (access.limit && !canAccessProject(access.limit, project)) return false;
  return access.projectIds.includes(project.id) || access.clientIds.includes(project.clientId);
}

/** Arma el alcance a partir de lo que se guarda en la base. */
export function accessFromRow(row: { allAccess: boolean; clientIds: string[]; projectIds: string[] }): KeyAccess {
  return row.allAccess ? ACCESS_ALL : { all: false, clientIds: [...row.clientIds], projectIds: [...row.projectIds] };
}

/** Texto corto para la lista de claves: «Acceso total» o «2 clientes · 1 proyecto». */
export function accessSummary(access: KeyAccess): string {
  if (access.all) return "Acceso total";
  const c = access.clientIds.length;
  const p = access.projectIds.length;
  const parts = [c > 0 ? `${c} ${c === 1 ? "cliente" : "clientes"}` : null, p > 0 ? `${p} ${p === 1 ? "proyecto" : "proyectos"}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Sin acceso";
}
