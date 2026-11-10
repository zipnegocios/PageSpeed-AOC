/**
 * Quién ve qué dentro del equipo. Lógica pura: sin base de datos.
 *
 * - El **propietario** (rol `owner`) ve todo.
 * - Un **miembro** (rol `admin`) ve los clientes de los que es responsable (`clients.owner_id`), los que le compartieron enteros y los
 *   proyectos que le compartieron sueltos.
 * - Quien recibe algo compartido lo opera igual que el responsable, salvo `canManage`: compartir, reasignar el responsable, archivar,
 *   restaurar, borrar y suspender.
 *
 * El «alcance» es el mismo `KeyAccess` de las claves de agentes (todo, o una lista de clientes y de proyectos): un proyecto es visible si
 * está su id o su cliente, así que un proyecto nuevo de un cliente compartido entra solo.
 */
import { ACCESS_ALL, canAccessProject, type KeyAccess } from "./mcp-access";

export type Role = "owner" | "admin";
export type Actor = { id: string; role: Role };
export type Scope = KeyAccess;
export type ShareRow = { clientId: string; projectId: string | null };

/** El alcance de una persona a partir de sus compartidos y de los clientes de los que es responsable. */
export function buildScope(actor: Actor, input: { shares: ShareRow[]; ownClientIds: string[] }): Scope {
  if (actor.role === "owner") return ACCESS_ALL;
  const clientIds = new Set(input.ownClientIds);
  const projectIds = new Set<string>();
  for (const s of input.shares) {
    if (s.projectId === null) clientIds.add(s.clientId);
    else projectIds.add(s.projectId);
  }
  return { all: false, clientIds: [...clientIds], projectIds: [...projectIds] };
}

export const canViewProject = (scope: Scope, project: { id: string; clientId: string }): boolean => canAccessProject(scope, project);

/**
 * Cómo ve un cliente: «full» (es suyo o se lo compartieron entero: ve todo, también el PIN y el contacto), «projects-only» (solo
 * le compartieron proyectos sueltos: ve el nombre y esos proyectos) o null (no lo ve). `projectIdsOfClient`: los proyectos del cliente.
 */
export type ClientLevel = "full" | "projects-only";
export function clientLevel(scope: Scope, clientId: string, projectIdsOfClient: readonly string[]): ClientLevel | null {
  if (scope.all || scope.clientIds.includes(clientId)) return "full";
  return projectIdsOfClient.some((p) => scope.projectIds.includes(p)) ? "projects-only" : null;
}

/** Compartir, reasignar el responsable, archivar, restaurar, borrar y suspender: el propietario o el responsable del cliente. */
export function canManage(actor: Actor, client: { ownerId: string | null }): boolean {
  return actor.role === "owner" || client.ownerId === actor.id;
}

/** De dónde le viene a esta persona el acceso a un proyecto (para mostrarlo en el panel). */
export type AccessSource = "owner" | "responsible" | "client-share" | "project-share";
export function accessSource(actor: Actor, scope: Scope, project: { id: string; clientId: string }, client: { ownerId: string | null }): AccessSource | null {
  if (actor.role === "owner") return "owner";
  if (client.ownerId === actor.id) return "responsible";
  if (scope.all) return "owner";
  if (scope.clientIds.includes(project.clientId)) return "client-share";
  return scope.projectIds.includes(project.id) ? "project-share" : null;
}

/** Texto corto de lo que ve alguien, para `/admin/equipo`: «3 clientes · 2 proyectos» (los proyectos de clientes enteros no se cuentan aparte). */
export function scopeSummary(scope: Scope): string {
  if (scope.all) return "Todo";
  const c = scope.clientIds.length;
  const p = scope.projectIds.length;
  const parts = [c > 0 ? `${c} ${c === 1 ? "cliente" : "clientes"}` : null, p > 0 ? `${p} ${p === 1 ? "proyecto suelto" : "proyectos sueltos"}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Nada todavía";
}

/**
 * Recorta el alcance de una clave de agente al de quien la creó: la clave nunca ve más que su creador. Con `all` en uno de los dos se
 * queda con el otro; con dos listas, un proyecto entra solo si lo permiten ambos (se evalúa por proyecto, así un proyecto suelto de la
 * clave vale si el creador lo ve por su cliente completo).
 */
export function intersectAccess(key: KeyAccess, creator: Scope): KeyAccess {
  if (creator.all) return key;
  if (key.all) return creator;
  return { ...key, limit: key.limit ? intersectAccess(key.limit, creator) : creator };
}
