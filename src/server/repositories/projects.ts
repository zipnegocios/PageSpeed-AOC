import type { Scope } from "@/server/domain/access";
import { scopeWhere } from "./scope";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { logoInfo, type ClientLogoInfo } from "@/server/domain/client-logo";
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
    .where(and(eq(projects.clientId, clientId), or(eq(projects.slug, slug), sql`${slug} = any(${projects.slugAliases})`), live(), isNull(clients.deletedAt)))
    .limit(1);
  return row ? { ...row.project, clientName: row.clientName, clientSlug: row.clientSlug } : undefined;
}

export async function projectSlugTaken(db: Database, clientId: string, slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.clientId, clientId), or(eq(projects.slug, slug), sql`${slug} = any(${projects.slugAliases})`)))
    .limit(1);
  return Boolean(row);
}

/** Cambia el identificador y guarda el anterior como alias. Si se vuelve a uno anterior propio, deja de ser alias. */
export async function setProjectSlug(db: Database, id: string, slug: string, previous: string): Promise<Project | undefined> {
  const [row] = await db
    .update(projects)
    .set({ slug, slugAliases: sql`array_append(array_remove(${projects.slugAliases}, ${slug}), ${previous})` })
    .where(and(eq(projects.id, id), live()))
    .returning();
  return row;
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

export async function listProductionProjectsInfo(db: Database, scope?: Scope): Promise<ProductionProjectInfo[]> {
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
    .where(and(eq(projects.phase, "production"), live(), isNull(clients.deletedAt), scopeWhere(scope, projects.id, projects.clientId)))
    .orderBy(asc(clients.name), asc(projects.name));
}

export type ProjectListing = {
  id: string;
  name: string;
  slug: string;
  clientSlug: string;
  baseUrl: string;
  phase: "development" | "production";
  auditFrequency: "weekly" | "daily";
  clientId: string;
  clientName: string;
  /** Logotipo del cliente (para dibujarlo junto al proyecto); null si no tiene. */
  clientLogo: ClientLogoInfo | null;
};

/** Todos los proyectos vigentes con su cliente, para listados. Con `scope`, solo los que ese alcance permite. */
export async function listAllProjects(db: Database, scope?: Scope): Promise<ProjectListing[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      clientSlug: clients.slug,
      baseUrl: projects.baseUrl,
      phase: projects.phase,
      auditFrequency: projects.auditFrequency,
      clientId: clients.id,
      clientName: clients.name,
      logoIconKey: clients.logoIconKey,
      logoFullKey: clients.logoFullKey,
      logoBg: clients.logoBg,
      logoUpdatedAt: clients.logoUpdatedAt,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(isNull(projects.deletedAt), isNull(clients.deletedAt), scopeWhere(scope, projects.id, projects.clientId)))
    .orderBy(asc(sql`lower(${clients.name})`), asc(sql`lower(${projects.name})`));
  return rows.map(({ logoIconKey, logoFullKey, logoBg, logoUpdatedAt, ...p }) => ({ ...p, clientLogo: logoInfo({ logoIconKey, logoFullKey, logoBg, logoUpdatedAt }) }));
}

/** Qué es el proyecto y en qué está hecho, para los correos al cliente. */
export async function setProjectEmailProfile(
  db: Database,
  id: string,
  values: { kind: "site" | "shop" | "app"; techLabel: string; includesServer: boolean },
): Promise<void> {
  await db.update(projects).set(values).where(and(eq(projects.id, id), live()));
}
