import { and, asc, eq, gte, inArray, lte, sql, getTableColumns } from "drizzle-orm";
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
  projectId: string;
  routeId: string;
  profile: "mobile" | "desktop";
  rank: number;
  agenticPassed: number | null;
  agenticTotal: number | null;
};

/**
 * Las dos últimas auditorías correctas por ruta y perfil (rank 1 = la más reciente) de uno o varios proyectos, en una
 * sola consulta. La partición es por ruta y perfil, así que agrupar varios proyectos no cambia el resultado de cada uno.
 */
export async function listLatestTwoMany(db: Database, projectIds: string[]): Promise<LatestRow[]> {
  if (projectIds.length === 0) return [];
  const cols = getTableColumns(auditLogs);
  const ranked = db
    .select({
      id: cols.id,
      projectId: cols.projectId,
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
    .where(and(inArray(auditLogs.projectId, projectIds), eq(auditLogs.status, "succeeded")))
    .as("ranked");
  const rows = await db.select().from(ranked).where(lte(ranked.rank, 2));
  return rows
    .filter((r): r is typeof r & { finishedAt: Date } => r.finishedAt !== null)
    .map((r) => ({ ...r, rank: Number(r.rank) }));
}

/** Las dos últimas auditorías correctas por ruta y perfil de un proyecto. */
export async function listLatestTwo(db: Database, projectId: string): Promise<LatestRow[]> {
  return listLatestTwoMany(db, [projectId]);
}

export type MonitoredRoute = { id: string; path: string };
export type MonitoredRouteOf = MonitoredRoute & { projectId: string };

/** Rutas monitoreadas de varios proyectos en una consulta. */
export function listMonitoredRoutesMany(db: Database, projectIds: string[]): Promise<MonitoredRouteOf[]> {
  if (projectIds.length === 0) return Promise.resolve([]);
  return db
    .select({ id: routes.id, path: routes.path, projectId: routes.projectId })
    .from(routes)
    .where(and(inArray(routes.projectId, projectIds), eq(routes.monitored, true)))
    .orderBy(asc(routes.path));
}

export type DailyPerformance = { projectId: string; day: string; value: number };

/** Rendimiento medio por día (UTC) de cada proyecto desde `since`: la serie de las miniaturas del panel. */
export async function listDailyPerformance(db: Database, projectIds: string[], since: Date): Promise<DailyPerformance[]> {
  if (projectIds.length === 0) return [];
  const day = sql<string>`to_char(date_trunc('day', ${auditLogs.finishedAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const rows = await db
    .select({ projectId: auditLogs.projectId, day, value: sql<number>`avg(${auditLogs.scorePerformance})::float` })
    .from(auditLogs)
    .where(and(inArray(auditLogs.projectId, projectIds), eq(auditLogs.status, "succeeded"), gte(auditLogs.finishedAt, since)))
    .groupBy(auditLogs.projectId, day)
    .orderBy(asc(day));
  return rows.flatMap((r) => (r.value === null || Number.isNaN(Number(r.value)) ? [] : [{ projectId: r.projectId, day: r.day, value: Number(r.value) }]));
}


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
