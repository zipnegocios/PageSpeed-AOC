import type { ClientLogoInfo } from "@/server/domain/client-logo";
import { getDb, type Database } from "@/server/db/client";
import { average, type Change } from "@/server/domain/history";
import * as repo from "@/server/repositories/dashboard";
import { listDailyPerformance } from "@/server/repositories/history";
import { listAllProjects } from "@/server/repositories/projects";
import { listOpenAlerts } from "./alerts";
import { averageScores, getLatestScoresMany, type LatestScores } from "./history";

export type RecentAudit = repo.RecentAuditRow;
export type { ProjectListing } from "@/server/repositories/projects";

export type FleetProject = {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  phase: "development" | "production";
  clientId: string;
  clientName: string;
  clientSlug: string;
  /** Logotipo del cliente, si lo tiene. */
  clientLogo?: ClientLogoInfo | null;
  /** Promedio de las últimas puntuaciones de todas sus rutas y perfiles (null si aún no hay auditorías correctas). */
  scores: ReturnType<typeof averageScores>;
  /** Variación media del rendimiento frente a la auditoría anterior (null si no hay anterior). */
  performanceChange: Change | null;
  /** Navegación con agentes: superadas / totales sumando rutas y perfiles que la midieron. */
  agentic: { passed: number; total: number } | null;
  /** La última auditoría correcta de cada dispositivo (la más reciente entre sus rutas), para enlazarlas directo. */
  lastByProfile: { mobile: { id: string; finishedAt: Date } | null; desktop: { id: string; finishedAt: Date } | null };
  /** La auditoría correcta más reciente del proyecto, para enlazarla directo. */
  lastAudit: { id: string; finishedAt: Date; routePath: string; profile: "mobile" | "desktop" } | null;
  /** Rendimiento medio diario de los últimos días (UTC), de más antiguo a más reciente. */
  sparkline: number[];
  openAlerts: number;
  /** Auditorías en cola o en curso. */
  pending: number;
};

export const SPARKLINE_DAYS = 30;

/** Variación media del rendimiento entre las últimas dos auditorías de cada ruta y perfil. */
export function meanPerformanceChange(latest: LatestScores[]): Change | null {
  const diffs = latest.flatMap((l) => (l.changes.performance ? [l.changes.performance.diff] : []));
  if (diffs.length === 0) return null;
  const mean = average(diffs.map((d) => d)) ?? 0;
  if (mean === 0) return { diff: 0, direction: "same", verdict: "same", text: "sin cambio" };
  const abs = Math.abs(mean);
  return { diff: mean, direction: mean > 0 ? "up" : "down", verdict: mean > 0 ? "better" : "worse", text: `${abs} ${abs === 1 ? "punto" : "puntos"}` };
}

function newestOf(latest: LatestScores[], profile: "mobile" | "desktop") {
  const best = latest.filter((l) => l.profile === profile).reduce<LatestScores | null>((b, l) => (b === null || l.finishedAt > b.finishedAt ? l : b), null);
  return best ? { id: best.auditId, finishedAt: best.finishedAt } : null;
}

function sumAgentic(latest: LatestScores[]): FleetProject["agentic"] {
  const items = latest.flatMap((l) => (l.agentic ? [l.agentic] : []));
  return items.length === 0 ? null : { passed: items.reduce((a, i) => a + i.passed, 0), total: items.reduce((a, i) => a + i.total, 0) };
}

/**
 * La flota: todos los proyectos vigentes con sus últimas puntuaciones, miniatura de rendimiento, alertas y pendientes.
 * Son 5 consultas en total sea cual sea el número de proyectos (sin una consulta por proyecto).
 */
export async function getFleet(db: Database = getDb(), now: Date = new Date()): Promise<FleetProject[]> {
  const list = await listAllProjects(db);
  const ids = list.map((p) => p.id);
  const since = new Date(now.getTime() - SPARKLINE_DAYS * 86_400_000);
  const [latestBy, daily, pending, alerts] = await Promise.all([
    getLatestScoresMany(ids, db),
    listDailyPerformance(db, ids, since),
    repo.listPendingCounts(db, ids),
    listOpenAlerts(undefined, db).catch(() => []),
  ]);
  const alertCount = new Map<string, number>();
  for (const a of alerts) alertCount.set(a.projectId, (alertCount.get(a.projectId) ?? 0) + 1);
  return list.map((p) => {
    const latest = latestBy.get(p.id) ?? [];
    const newest = latest.reduce<LatestScores | null>((best, l) => (best === null || l.finishedAt > best.finishedAt ? l : best), null);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      baseUrl: p.baseUrl,
      phase: p.phase,
      clientId: p.clientId,
      clientName: p.clientName,
      clientSlug: p.clientSlug,
      clientLogo: p.clientLogo,
      scores: averageScores(latest),
      performanceChange: meanPerformanceChange(latest),
      agentic: sumAgentic(latest),
      lastByProfile: {
        mobile: newestOf(latest, "mobile"),
        desktop: newestOf(latest, "desktop"),
      },
      lastAudit: newest ? { id: newest.auditId, finishedAt: newest.finishedAt, routePath: newest.path, profile: newest.profile } : null,
      sparkline: daily.filter((d) => d.projectId === p.id).map((d) => Math.round(d.value)),
      openAlerts: alertCount.get(p.id) ?? 0,
      pending: pending.get(p.id) ?? 0,
    };
  });
}

/** Las últimas auditorías de todos los proyectos (para ir a una en un solo clic). */
export function listRecentAuditsGlobal(limit = 12, db: Database = getDb()): Promise<RecentAudit[]> {
  return repo.listRecentAuditsGlobal(db, Math.min(Math.max(limit, 1), 50));
}

/** Resumen de la flota para las cifras de cabecera. */
export function summarizeFleet(fleet: FleetProject[]) {
  const withScores = fleet.filter((p) => p.scores.performance !== null);
  return {
    projects: fleet.length,
    production: fleet.filter((p) => p.phase === "production").length,
    development: fleet.filter((p) => p.phase === "development").length,
    performance: average(withScores.map((p) => p.scores.performance)),
    seo: average(withScores.map((p) => p.scores.seo)),
    accessibility: average(withScores.map((p) => p.scores.accessibility)),
    bestPractices: average(withScores.map((p) => p.scores.best_practices)),
    openAlerts: fleet.reduce((a, p) => a + p.openAlerts, 0),
    pending: fleet.reduce((a, p) => a + p.pending, 0),
    withoutAudits: fleet.filter((p) => p.lastAudit === null).length,
  };
}

/**
 * Orden de la flota para mirarla de un vistazo: primero lo que necesita atención (más alertas abiertas, luego menor
 * rendimiento), después lo sano y al final lo que aún no tiene auditorías. A igualdad, por cliente y proyecto.
 */
export function sortFleet(fleet: FleetProject[]): FleetProject[] {
  const key = (p: FleetProject) => (p.scores.performance === null ? 101 : p.scores.performance);
  return [...fleet].sort(
    (a, b) =>
      b.openAlerts - a.openAlerts ||
      key(a) - key(b) ||
      a.clientName.localeCompare(b.clientName, "es") ||
      a.name.localeCompare(b.name, "es"),
  );
}

/** Una página del listado reciente: sus dos dispositivos juntos (cada lado, su auditoría más reciente). */
export type PageFeedEntry = {
  key: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  clientName: string;
  clientSlug: string;
  routePath: string;
  mobile: RecentAudit | null;
  desktop: RecentAudit | null;
};

/**
 * Colapsa auditorías (de la más reciente a la más antigua) en una entrada por proyecto + ruta. Cada dispositivo conserva
 * su auditoría más reciente; las entradas salen en el orden en que aparece su primera auditoría.
 */
export function groupAuditsByPage(rows: RecentAudit[]): PageFeedEntry[] {
  const map = new Map<string, PageFeedEntry>();
  for (const r of rows) {
    const key = `${r.projectId}|${r.routePath}`;
    let e = map.get(key);
    if (!e) {
      e = { key, projectId: r.projectId, projectName: r.projectName, projectSlug: r.projectSlug, clientName: r.clientName, clientSlug: r.clientSlug, routePath: r.routePath, mobile: null, desktop: null };
      map.set(key, e);
    }
    if (!e[r.profile]) e[r.profile] = r;
  }
  return [...map.values()];
}

/** Las páginas con actividad más reciente de todos los proyectos, cada una con sus dos dispositivos. */
export async function listRecentPagesGlobal(limit = 10, db: Database = getDb()): Promise<PageFeedEntry[]> {
  const wanted = Math.min(Math.max(limit, 1), 30);
  const rows = await repo.listRecentAuditsGlobal(db, wanted * 6);
  return groupAuditsByPage(rows).slice(0, wanted);
}
