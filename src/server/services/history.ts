import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import {
  average, computeChange, metricValue, periodStart,
  type Change, type HistoryMetric, type Period,
} from "@/server/domain/history";
import * as repo from "@/server/repositories/history";
import { assertUuid } from "./shared";
import { getThresholds } from "./thresholds";

type Profile = "mobile" | "desktop";
const METRIC_KEYS = ["performance", "seo", "accessibility", "best_practices"] as const;

export type Series = {
  route: repo.MonitoredRoute;
  profile: Profile;
  metric: HistoryMetric;
  from: Date;
  to: Date;
  points: Array<{ at: Date; value: number; auditId: string }>;
  /** Meta (umbral) de la métrica, solo para puntuaciones con la alerta activa. */
  threshold: number | null;
};

/** Evolución de una métrica en una ruta y perfil. La ruta debe pertenecer al proyecto. */
export async function getSeries(
  input: { projectId: string; routeId: string; profile: Profile; metric: HistoryMetric; days: Period },
  db: Database = getDb(),
  now: Date = new Date(),
): Promise<Series> {
  assertUuid(input.projectId, "Proyecto");
  assertUuid(input.routeId, "Ruta");
  const route = await repo.findRouteInProject(db, input.projectId, input.routeId);
  if (!route) throw new DomainError("NOT_FOUND", "Ruta no encontrada.");
  const from = periodStart(now, input.days);
  const rows = await repo.listSeries(db, route.id, input.profile, from);
  const points = rows.flatMap((r) => {
    const value = metricValue(r, input.metric);
    return value === null ? [] : [{ at: r.finishedAt, value, auditId: r.id }];
  });
  const isScore = (METRIC_KEYS as readonly string[]).includes(input.metric);
  const threshold = isScore
    ? ((await getThresholds(input.projectId, db)).find((t) => t.metric === input.metric && t.enabled)?.minScore ?? null)
    : null;
  return { route, profile: input.profile, metric: input.metric, from, to: now, points, threshold };
}

export type LatestScores = {
  routeId: string;
  path: string;
  profile: Profile;
  auditId: string;
  finishedAt: Date;
  scores: Record<(typeof METRIC_KEYS)[number], number | null>;
  /** Variación de cada puntuación respecto a la auditoría anterior (null si no hay anterior). */
  changes: Record<(typeof METRIC_KEYS)[number], Change | null>;
};

/** Última auditoría correcta de cada ruta monitoreada y perfil, con la variación respecto a la anterior. */
export async function getLatestScores(projectId: string, db: Database = getDb()): Promise<LatestScores[]> {
  assertUuid(projectId, "Proyecto");
  const [routes, rows] = await Promise.all([repo.listMonitoredRoutes(db, projectId), repo.listLatestTwo(db, projectId)]);
  const out: LatestScores[] = [];
  for (const route of routes) {
    for (const profile of ["mobile", "desktop"] as const) {
      const mine = rows.filter((r) => r.routeId === route.id && r.profile === profile);
      const latest = mine.find((r) => r.rank === 1);
      if (!latest) continue;
      const prev = mine.find((r) => r.rank === 2);
      const pick = (m: (typeof METRIC_KEYS)[number]) => metricValue(latest, m);
      out.push({
        routeId: route.id,
        path: route.path,
        profile,
        auditId: latest.id,
        finishedAt: latest.finishedAt,
        scores: Object.fromEntries(METRIC_KEYS.map((m) => [m, pick(m)])) as LatestScores["scores"],
        changes: Object.fromEntries(
          METRIC_KEYS.map((m) => [m, prev ? computeChange(m, pick(m), metricValue(prev, m)) : null]),
        ) as LatestScores["changes"],
      });
    }
  }
  return out;
}

/** Promedio de las últimas puntuaciones de todas las rutas y perfiles. */
export function averageScores(latest: LatestScores[]): Record<(typeof METRIC_KEYS)[number], number | null> {
  return Object.fromEntries(METRIC_KEYS.map((m) => [m, average(latest.map((l) => l.scores[m]))])) as Record<
    (typeof METRIC_KEYS)[number],
    number | null
  >;
}

/** Rutas monitoreadas de un proyecto, para elegir qué gráfica ver. */
export function listMonitoredRoutes(projectId: string, opts: { all?: boolean } = {}, db: Database = getDb()) {
  assertUuid(projectId, "Proyecto");
  return repo.listMonitoredRoutes(db, projectId, !opts.all);
}

export type RouteHistoryRow = {
  auditId: string;
  at: Date;
  scores: Record<(typeof METRIC_KEYS)[number], number | null>;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
};

/** Auditorías correctas de una ruta en el periodo, de la más reciente a la más antigua. */
export async function getRouteHistory(
  input: { routeId: string; profile: Profile; days: number; limit?: number },
  db: Database = getDb(),
  now: Date = new Date(),
): Promise<RouteHistoryRow[]> {
  assertUuid(input.routeId, "Ruta");
  const rows = await repo.listSeries(db, input.routeId, input.profile, periodStart(now, input.days));
  return rows
    .slice(-Math.min(Math.max(input.limit ?? 50, 1), 200))
    .reverse()
    .map((r) => ({
      auditId: r.id,
      at: r.finishedAt,
      scores: Object.fromEntries(METRIC_KEYS.map((m) => [m, metricValue(r, m)])) as RouteHistoryRow["scores"],
      lcpMs: r.lcpMs,
      tbtMs: r.tbtMs,
      cls: metricValue(r, "cls"),
    }));
}
