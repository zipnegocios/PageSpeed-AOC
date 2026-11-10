import { inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Scope } from "@/server/domain/access";

/**
 * Condición SQL para quedarse con lo que un alcance permite: el proyecto (`projectId`) o su cliente (`clientId`). Con alcance total
 * o sin alcance (consultas del sistema: worker, portal del cliente) no filtra: devuelve `undefined`.
 */
export function scopeWhere(scope: Scope | undefined, projectId: PgColumn, clientId: PgColumn): SQL | undefined {
  if (!scope || scope.all) return undefined;
  const parts: SQL[] = [];
  if (scope.projectIds.length > 0) parts.push(inArray(projectId, scope.projectIds));
  if (scope.clientIds.length > 0) parts.push(inArray(clientId, scope.clientIds));
  return parts.length > 0 ? (or(...parts) as SQL) : sql`false`;
}

/** Igual, para consultas que solo tienen el cliente (listados de clientes): el cliente entra por su id o si tiene algún proyecto permitido. */
export function clientScopeWhere(scope: Scope | undefined, clientId: PgColumn, projectClientIds: SQL | undefined): SQL | undefined {
  if (!scope || scope.all) return undefined;
  const parts: SQL[] = [];
  if (scope.clientIds.length > 0) parts.push(inArray(clientId, scope.clientIds));
  if (projectClientIds) parts.push(projectClientIds);
  return parts.length > 0 ? (or(...parts) as SQL) : sql`false`;
}
