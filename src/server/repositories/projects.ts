import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { alertStates, alertThresholds, auditLogs, clients, projects, routes } from "@/server/db/schema";

export type Project = typeof projects.$inferSelect;
export type ProjectWithClient = Project & { clientName: string; clientSlug: string };

const live = (alias = projects) => isNull(alias.deletedAt);

export async function listProjectsForClient(db: Database, clientId: string): Promise<Array<Project & { routeCount: number }>> {
  const rows = await db
    .select({ project: projects, routeCount: count(routes.id) })
    .from(projects)
    .leftJoin(routes, eq(routes.projectId, projects.id))
    .where(and(eq(projects.clientId, clientId), live()))
    .groupBy(projects.id)
    .orderBy(asc(sql`lower(${projects.name})`));
  return rows.map((r) => ({ ...r.project, routeCount: r.routeCount }));
}

export async function findProject(db: Database, id: string): Promise<ProjectWithClient | undefined> {
  const [row] = await db
    .select({ project: projects, clientName: clients.name, clientSlug: clients.slug })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, id), live(), isNull(clients.deletedAt)))
    .limit(1);
  return row ? { ...row.project, clientName: row.clientName, clientSlug: row.clientSlug } : undefined;
}

export async function findProjectBySlug(db: Database, clientId: string, slug: string): Promise<ProjectWithClient | undefined> {
  const [row] = await db
    .select({ project: projects, clientName: clients.name, clientSlug: clients.slug })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.clientId, clientId), eq(projects.slug, slug), live(), isNull(clients.deletedAt)))
    .limit(1);
  return row ? { ...row.project, clientName: row.clientName, clientSlug: row.clientSlug } : undefined;
}

export async function projectSlugTaken(db: Database, clientId: string, slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.slug, slug)))
    .limit(1);
  return Boolean(row);
}

export async function updateProject(
  db: Database,
  id: string,
  values: Partial<typeof projects.$inferInsert>,
): Promise<Project | undefined> {
  const [row] = await db
    .update(projects)
    .set(values)
    .where(and(eq(projects.id, id), live()))
    .returning();
  return row;
}

export async function suppressOpenAlerts(db: Database, projectId: string): Promise<number> {
  const rows = await db
    .update(alertStates)
    .set({ status: "suppressed" })
    .where(and(eq(alertStates.projectId, projectId), eq(alertStates.status, "open")))
    .returning({ id: alertStates.id });
  return rows.length;
}

export async function countAuditLogs(db: Database, projectId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.projectId, projectId));
  return row?.n ?? 0;
}

export { alertThresholds };

export type ProductionProject = { id: string; auditFrequency: "weekly" | "daily" };

/** Proyectos que deben tener agendador: en producción, no archivados y con cliente activo en el sistema. */
export async function listProductionProjects(db: Database): Promise<ProductionProject[]> {
  return db
    .select({ id: projects.id, auditFrequency: projects.auditFrequency })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.phase, "production"), live(), isNull(clients.deletedAt)));
}

export type ProductionProjectInfo = ProductionProject & { name: string; slug: string; clientId: string; clientName: string; clientSlug: string };

export async function listProductionProjectsInfo(db: Database): Promise<ProductionProjectInfo[]> {
  return db
    .select({
      id: projects.id,
      auditFrequency: projects.auditFrequency,
      name: projects.name,
      slug: projects.slug,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.phase, "production"), live(), isNull(clients.deletedAt)))
    .orderBy(asc(clients.name), asc(projects.name));
}

export type ProjectListing = {
  id: string;
  name: string;
  baseUrl: string;
  phase: "development" | "production";
  auditFrequency: "weekly" | "daily";
  clientId: string;
  clientName: string;
};

/** Todos los proyectos vigentes con su cliente, para listados. */
export async function listAllProjects(db: Database): Promise<ProjectListing[]> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      baseUrl: projects.baseUrl,
      phase: projects.phase,
      auditFrequency: projects.auditFrequency,
      clientId: clients.id,
      clientName: clients.name,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(isNull(projects.deletedAt), isNull(clients.deletedAt)))
    .orderBy(asc(sql`lower(${clients.name})`), asc(sql`lower(${projects.name})`));
}
