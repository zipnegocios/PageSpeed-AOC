import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import * as repo from "@/server/repositories/seo-portal";
import { getSeoDashboard, type SeoDashboard } from "./seo-data";
import { assertUuid } from "./shared";

export type SeoSharing = { visible: boolean; /** El cliente también ve los proyectos en desarrollo: esto solo informa de la fase. */ inProduction: boolean };

/** Si el cliente ve «Tráfico y búsqueda» de este proyecto en su portal (por defecto, no). */
export async function getSeoSharing(projectId: string, db: Database = getDb()): Promise<SeoSharing> {
  assertUuid(projectId, "Proyecto");
  const row = await repo.getClientVisible(db, projectId);
  if (!row) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  return { visible: row.visible, inProduction: row.phase === "production" };
}

export async function setSeoClientVisible(projectId: string, visible: boolean, db: Database = getDb()): Promise<void> {
  assertUuid(projectId, "Proyecto");
  if ((await repo.setClientVisible(db, projectId, visible)) === 0) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
}

/**
 * Lo que ve el cliente en su portal: el mismo panel que el administrador, o null si no corresponde mostrarlo (el proyecto
 * no es de este cliente, está archivado, el administrador no lo activó o no tiene ninguna conexión). Es la única
 * puerta del portal a estos datos: se comprueba aquí, no en la pantalla.
 */
export async function getPortalSeoDashboard(clientId: string, projectId: string, opts: { days: number; lang?: string }, db: Database = getDb()): Promise<SeoDashboard | null> {
  assertUuid(clientId, "Cliente");
  assertUuid(projectId, "Proyecto");
  if (!(await repo.findPortalSeoProject(db, clientId, projectId))) return null;
  const dashboard = await getSeoDashboard(projectId, opts, db);
  return dashboard.sync.gsc || dashboard.sync.ga4 ? dashboard : null;
}
