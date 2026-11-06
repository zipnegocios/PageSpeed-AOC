import { getDb, type Database } from "@/server/db/client";
import * as repo from "@/server/repositories/audits";
import { listRoutes } from "@/server/repositories/routes";
import type { AuditWithRoute } from "./audits";
import { getLatestScoresAllRoutes, type LatestScores } from "./history";
import { assertUuid } from "./shared";

type Profile = "mobile" | "desktop";

/** Estado del dispositivo según su auditoría MÁS reciente (de cualquier estado). */
export type ProfileState = "ok" | "pending" | "failed" | "none";

export type ProfileBlock = {
  profile: Profile;
  /** La última auditoría correcta con su variación frente a la anterior (null si nunca hubo una). */
  latest: LatestScores | null;
  /** Las últimas auditorías de este dispositivo (cualquier estado), la más reciente primero. */
  recent: AuditWithRoute[];
  pending: boolean;
  state: ProfileState;
};

export type PageAudits = {
  route: { id: string; path: string; label: string | null; monitored: boolean; requiresAuth: boolean };
  mobile: ProfileBlock;
  desktop: ProfileBlock;
};

function stateOf(newest: AuditWithRoute | undefined): ProfileState {
  if (!newest) return "none";
  if (newest.status === "queued" || newest.status === "running") return "pending";
  return newest.status === "failed" ? "failed" : "ok";
}

/**
 * Las páginas (rutas) de un proyecto con sus dos dispositivos: última auditoría correcta, últimas auditorías y estado.
 * Entran las rutas monitoreadas y cualquier ruta que ya tenga auditorías (p. ej. las ad hoc). La página de inicio va
 * primero y el resto por ruta. Son 3 consultas sea cual sea el número de páginas.
 */
export async function getPageAudits(projectId: string, opts: { recent?: number } = {}, db: Database = getDb()): Promise<PageAudits[]> {
  assertUuid(projectId, "Proyecto");
  const n = Math.min(Math.max(opts.recent ?? 5, 1), 20);
  const [routes, recent, latest] = await Promise.all([listRoutes(db, projectId), repo.listRecentPerRouteProfile(db, projectId, n), getLatestScoresAllRoutes(projectId, db)]);
  const block = (routeId: string, profile: Profile): ProfileBlock => {
    const list = recent.filter((a) => a.routeId === routeId && a.profile === profile);
    return {
      profile,
      latest: latest.find((l) => l.routeId === routeId && l.profile === profile) ?? null,
      recent: list,
      pending: list.some((a) => a.status === "queued" || a.status === "running"),
      state: stateOf(list[0]),
    };
  };
  return routes
    .map((r) => ({
      route: { id: r.id, path: r.path, label: r.label, monitored: r.monitored, requiresAuth: r.requiresAuth },
      mobile: block(r.id, "mobile"),
      desktop: block(r.id, "desktop"),
    }))
    .filter((p) => p.route.monitored || p.mobile.recent.length > 0 || p.desktop.recent.length > 0)
    .sort((a, b) => (a.route.path === "/" ? -1 : b.route.path === "/" ? 1 : a.route.path.localeCompare(b.route.path)));
}

/** Dispositivo con que abrir las pestañas: el de la auditoría más reciente; a igualdad, móvil. */
export function defaultProfile(page: Pick<PageAudits, "mobile" | "desktop">): Profile {
  const at = (b: ProfileBlock) => (b.recent[0] ? (b.recent[0].finishedAt ?? b.recent[0].queuedAt).getTime() : 0);
  return at(page.desktop) > at(page.mobile) ? "desktop" : "mobile";
}
