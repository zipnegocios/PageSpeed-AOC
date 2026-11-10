import { and, asc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { adminUsers, clients, mcpApiKeys, teamShares } from "@/server/db/schema";

export type TeamShare = typeof teamShares.$inferSelect;

/** Lo que una persona tiene compartido (enteros y sueltos). */
export function listSharesForAdmin(db: Database, adminId: string): Promise<Array<{ clientId: string; projectId: string | null }>> {
  return db.select({ clientId: teamShares.clientId, projectId: teamShares.projectId }).from(teamShares).where(eq(teamShares.adminId, adminId));
}

/** Los clientes de los que la persona es responsable (también los archivados: sus listas de archivados los necesitan). */
export async function listOwnClientIds(db: Database, adminId: string): Promise<string[]> {
  const rows = await db.select({ id: clients.id }).from(clients).where(eq(clients.ownerId, adminId));
  return rows.map((r) => r.id);
}

/** Con quién está compartido un cliente (entero o algún proyecto suyo), para la tarjeta «Compartir». */
export function listSharesForClient(db: Database, clientId: string): Promise<Array<{ id: string; adminId: string; projectId: string | null; email: string; firstName: string | null; lastName: string | null }>> {
  return db
    .select({ id: teamShares.id, adminId: teamShares.adminId, projectId: teamShares.projectId, email: adminUsers.email, firstName: adminUsers.firstName, lastName: adminUsers.lastName })
    .from(teamShares)
    .innerJoin(adminUsers, eq(adminUsers.id, teamShares.adminId))
    .where(eq(teamShares.clientId, clientId))
    .orderBy(asc(adminUsers.createdAt));
}

export async function insertShare(db: Database, v: { adminId: string; clientId: string; projectId: string | null; grantedBy: string | null }): Promise<void> {
  await db.insert(teamShares).values(v).onConflictDoNothing();
}

export async function deleteClientShare(db: Database, adminId: string, clientId: string): Promise<void> {
  await db.delete(teamShares).where(and(eq(teamShares.adminId, adminId), eq(teamShares.clientId, clientId), isNull(teamShares.projectId)));
}

export async function deleteProjectShare(db: Database, adminId: string, projectId: string): Promise<void> {
  await db.delete(teamShares).where(and(eq(teamShares.adminId, adminId), eq(teamShares.projectId, projectId), isNotNull(teamShares.projectId)));
}

/** Al quitar a alguien del equipo sus clientes pasan a otra cuenta (el propietario). Devuelve cuántos. */
export async function reassignClients(db: Database, fromAdminId: string, toAdminId: string): Promise<number> {
  const rows = await db.update(clients).set({ ownerId: toAdminId }).where(eq(clients.ownerId, fromAdminId)).returning({ id: clients.id });
  return rows.length;
}

/** Sus claves de agente dejan de existir con la persona. */
export async function deleteKeysCreatedBy(db: Database, adminId: string): Promise<number> {
  const rows = await db.delete(mcpApiKeys).where(eq(mcpApiKeys.createdBy, adminId)).returning({ id: mcpApiKeys.id });
  return rows.length;
}

/** Cuántos clientes tiene a su cargo cada persona (para `/admin/equipo`). */
export async function countOwnedClientsByAdmin(db: Database): Promise<Array<{ adminId: string; clients: number }>> {
  const rows = await db
    .select({ adminId: clients.ownerId, clients: sql<number>`count(*)::int` })
    .from(clients)
    .where(and(isNotNull(clients.ownerId), isNull(clients.deletedAt)))
    .groupBy(clients.ownerId);
  return rows.flatMap((r) => (r.adminId ? [{ adminId: r.adminId, clients: r.clients }] : []));
}

/** Cuántos accesos sueltos tiene cada persona (para `/admin/equipo`). */
export async function countSharesByAdmin(db: Database): Promise<Array<{ adminId: string; clients: number; projects: number }>> {
  return db
    .select({
      adminId: teamShares.adminId,
      clients: sql<number>`count(*) filter (where ${teamShares.projectId} is null)::int`,
      projects: sql<number>`count(*) filter (where ${teamShares.projectId} is not null)::int`,
    })
    .from(teamShares)
    .groupBy(teamShares.adminId);
}
