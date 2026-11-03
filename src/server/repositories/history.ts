import { and, asc, eq, gte, lte, sql, getTableColumns } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { auditLogs, routes } from "@/server/db/schema";

export type SeriesRow = {
  id: string;
  finishedAt: Date;
  scorePerformance: number | null;
  scoreSeo: number | null;
  scoreAccessibility: number | null;
  scoreBestPractices: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: string | null;
};

const MAX_POINTS = 1000;

/** Auditorías correctas de una ruta y perfil desde `since`, de la más antigua a la más reciente. */
export async function listSeries(db: Database, routeId: string, profile: "mobile" | "desktop", since: Date): Promise<SeriesRow[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      finishedAt: auditLogs.finishedAt,
      scorePerformance: auditLogs.scorePerformance,
      scoreSeo: auditLogs.scoreSeo,
      scoreAccessibility: auditLogs.scoreAccessibility,
      scoreBestPractices: auditLogs.scoreBestPractices,
      lcpMs: auditLogs.lcpMs,
      tbtMs: auditLogs.tbtMs,
      cls: auditLogs.cls,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.routeId, routeId),
        eq(auditLogs.profile, profile),
        eq(auditLogs.status, "succeeded"),
        gte(auditLogs.finishedAt, since),
        lte(auditLogs.finishedAt, new Date(Date.now() + 86_400_000)),
      ),
    )
    .orderBy(asc(auditLogs.finishedAt))
    .limit(MAX_POINTS);
  return rows.filter((r): r is SeriesRow => r.finishedAt !== null);
}

export type LatestRow = SeriesRow & {
  routeId: string;
  profile: "mobile" | "desktop";
  rank: number;
  agenticPassed: number | null;
  agenticTotal: number | null;
};

/** Las dos últimas auditorías correctas por ruta y perfil de un proyecto (rank 1 = la más reciente). */
export async function listLatestTwo(db: Database, projectId: string): Promise<LatestRow[]> {
  const cols = getTableColumns(auditLogs);
  const ranked = db
    .select({
      id: cols.id,
      routeId: cols.routeId,
      profile: cols.profile,
      finishedAt: cols.finishedAt,
      scorePerformance: cols.scorePerformance,
      scoreSeo: cols.scoreSeo,
      scoreAccessibility: cols.scoreAccessibility,
      scoreBestPractices: cols.scoreBestPractices,
      lcpMs: cols.lcpMs,
      tbtMs: cols.tbtMs,
      cls: cols.cls,
      agenticPassed: cols.agenticPassed,
      agenticTotal: cols.agenticTotal,
      rank: sql<number>`row_number() over (partition by ${auditLogs.routeId}, ${auditLogs.profile} order by ${auditLogs.finishedAt} desc)`.as("rank"),
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.status, "succeeded")))
    .as("ranked");
  const rows = await db.select().from(ranked).where(lte(ranked.rank, 2));
  return rows
    .filter((r): r is typeof r & { finishedAt: Date } => r.finishedAt !== null)
    .map((r) => ({ ...r, rank: Number(r.rank) }));
}

export type MonitoredRoute = { id: string; path: string };

export function listMonitoredRoutes(db: Database, projectId: string, onlyMonitored = true): Promise<MonitoredRoute[]> {
  return db
    .select({ id: routes.id, path: routes.path })
    .from(routes)
    .where(and(eq(routes.projectId, projectId), onlyMonitored ? eq(routes.monitored, true) : undefined))
    .orderBy(asc(routes.path));
}

export async function findRouteInProject(db: Database, projectId: string, routeId: string): Promise<MonitoredRoute | undefined> {
  const [row] = await db
    .select({ id: routes.id, path: routes.path })
    .from(routes)
    .where(and(eq(routes.projectId, projectId), eq(routes.id, routeId)))
    .limit(1);
  return row;
}
