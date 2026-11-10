import type { Scope } from "@/server/domain/access";
import { scopeWhere } from "./scope";
import { and, desc, inArray, isNull, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { auditLogs, clients, projects, routes } from "@/server/db/schema";

export type RecentAuditRow = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  profile: "mobile" | "desktop";
  routePath: string;
  errorCode: string | null;
  scorePerformance: number | null;
  scoreSeo: number | null;
  scoreAccessibility: number | null;
  scoreBestPractices: number | null;
  queuedAt: Date;
  finishedAt: Date | null;
  projectId: string;
  projectName: string;
  projectSlug: string;
  clientName: string;
  clientSlug: string;
};

/** Las últimas auditorías de todos los proyectos vigentes (de clientes no archivados), de la más reciente a la más antigua. */
export async function listRecentAuditsGlobal(db: Database, limit: number, scope?: Scope): Promise<RecentAuditRow[]> {
  return db
    .select({
      id: auditLogs.id,
      status: auditLogs.status,
      profile: auditLogs.profile,
      routePath: routes.path,
      errorCode: auditLogs.errorCode,
      scorePerformance: auditLogs.scorePerformance,
      scoreSeo: auditLogs.scoreSeo,
      scoreAccessibility: auditLogs.scoreAccessibility,
      scoreBestPractices: auditLogs.scoreBestPractices,
      queuedAt: auditLogs.queuedAt,
      finishedAt: auditLogs.finishedAt,
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      clientName: clients.name,
      clientSlug: clients.slug,
    })
    .from(auditLogs)
    .innerJoin(routes, eq(routes.id, auditLogs.routeId))
    .innerJoin(projects, eq(projects.id, auditLogs.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(isNull(projects.deletedAt), isNull(clients.deletedAt), scopeWhere(scope, projects.id, projects.clientId)))
    .orderBy(desc(auditLogs.queuedAt))
    .limit(limit);
}

/** Auditorías en cola o en curso por proyecto. */
export async function listPendingCounts(db: Database, projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: auditLogs.projectId, n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(inArray(auditLogs.projectId, projectIds), inArray(auditLogs.status, ["queued", "running"])))
    .groupBy(auditLogs.projectId);
  return new Map(rows.map((r) => [r.projectId, Number(r.n)]));
}
