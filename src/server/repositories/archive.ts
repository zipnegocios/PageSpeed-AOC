import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { auditLogs, clients, projects } from "@/server/db/schema";

export type ArchivedClient = {
  id: string;
  name: string;
  slug: string;
  archivedAt: Date;
  /** Todos sus proyectos, archivados o no: se eliminan junto con el cliente. */
  projectCount: number;
};

export type ArchivedProject = {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  archivedAt: Date;
  clientId: string;
  clientName: string;
  clientSlug: string;
};

/** Con `manageBy`, solo lo que esa persona puede restaurar o borrar: el propietario, todo; un miembro, los clientes de los que es responsable. */
export type ManageBy = { id: string; role: "owner" | "admin" } | undefined;
const managed = (by: ManageBy) => (!by || by.role === "owner" ? undefined : eq(clients.ownerId, by.id));

export async function listArchivedClients(db: Database, by?: ManageBy): Promise<ArchivedClient[]> {
  const rows = await db
    .select({ client: clients, projectCount: count(projects.id) })
    .from(clients)
    .leftJoin(projects, eq(projects.clientId, clients.id))
    .where(and(isNotNull(clients.deletedAt), managed(by)))
    .groupBy(clients.id)
    .orderBy(desc(clients.deletedAt));
  return rows.map((r) => ({ id: r.client.id, name: r.client.name, slug: r.client.slug, archivedAt: r.client.deletedAt as Date, projectCount: r.projectCount }));
}

/** Proyectos archivados de clientes vigentes (los de un cliente archivado viajan con su cliente). */
export async function listArchivedProjects(db: Database, by?: ManageBy): Promise<ArchivedProject[]> {
  const rows = await db
    .select({ project: projects, clientName: clients.name, clientSlug: clients.slug })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(isNotNull(projects.deletedAt), isNull(clients.deletedAt), managed(by)))
    .orderBy(asc(sql`lower(${clients.name})`), desc(projects.deletedAt));
  return rows.map((r) => ({
    id: r.project.id,
    name: r.project.name,
    slug: r.project.slug,
    baseUrl: r.project.baseUrl,
    archivedAt: r.project.deletedAt as Date,
    clientId: r.project.clientId,
    clientName: r.clientName,
    clientSlug: r.clientSlug,
  }));
}

export async function findArchivedClient(db: Database, id: string) {
  const [row] = await db.select().from(clients).where(and(eq(clients.id, id), isNotNull(clients.deletedAt))).limit(1);
  return row;
}

export async function findArchivedProject(db: Database, id: string) {
  const [row] = await db
    .select({ project: projects, clientSlug: clients.slug, clientSlugAliases: clients.slugAliases, clientDeletedAt: clients.deletedAt })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, id), isNotNull(projects.deletedAt)))
    .limit(1);
  return row;
}

export async function restoreClientRow(db: Database, id: string) {
  const [row] = await db.update(clients).set({ deletedAt: null }).where(and(eq(clients.id, id), isNotNull(clients.deletedAt))).returning();
  return row;
}

export async function restoreProjectRow(db: Database, id: string) {
  const [row] = await db.update(projects).set({ deletedAt: null }).where(and(eq(projects.id, id), isNotNull(projects.deletedAt))).returning();
  return row;
}

/** Claves de R2 que guardan las auditorías de un proyecto (aunque estén en una carpeta con un identificador anterior). */
export async function listProjectR2Keys(db: Database, projectId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ key: auditLogs.r2Key }).from(auditLogs).where(and(eq(auditLogs.projectId, projectId), isNotNull(auditLogs.r2Key)));
  return rows.flatMap((r) => (r.key ? [r.key] : []));
}

/** Idem para todos los proyectos de un cliente. */
export async function listClientR2Keys(db: Database, clientId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ key: auditLogs.r2Key })
    .from(auditLogs)
    .innerJoin(projects, eq(projects.id, auditLogs.projectId))
    .where(and(eq(projects.clientId, clientId), isNotNull(auditLogs.r2Key)));
  return rows.flatMap((r) => (r.key ? [r.key] : []));
}

/** Borra el proyecto; sus rutas, auditorías, alertas, avisos y datos reales caen en cascada. */
export async function deleteProjectRow(db: Database, id: string): Promise<void> {
  await db.delete(projects).where(and(eq(projects.id, id), isNotNull(projects.deletedAt)));
}

/** Borra el cliente con todos sus proyectos (la clave foránea de proyectos a cliente es restrictiva). */
export async function deleteClientRow(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(projects).where(eq(projects.clientId, id));
    await tx.delete(clients).where(and(eq(clients.id, id), isNotNull(clients.deletedAt)));
  });
}

