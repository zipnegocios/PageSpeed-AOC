import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { findClientByToken } from "@/server/repositories/clients";
import { listOpenAlerts, type AlertView } from "./alerts";
import { averageScores, getLatestScores, type LatestScores } from "./history";
import { assertUuid } from "./shared";

/** El token es de 32 bytes en base64url: 43 caracteres. Todo lo demás se descarta sin tocar la base de datos. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isPlausibleToken = (token: string) => TOKEN_RE.test(token);

export type PortalClient = { id: string; name: string };

export type PortalAccess =
  | { state: "invalid" }
  | { state: "suspended"; clientName: string }
  | { state: "ok"; client: PortalClient };

/** Resuelve el link mágico. Invalida al instante cuando se rota el token o se suspende al cliente. */
export async function resolvePortal(token: string, db: Database = getDb()): Promise<PortalAccess> {
  if (!isPlausibleToken(token)) return { state: "invalid" };
  const client = await findClientByToken(db, token);
  if (!client) return { state: "invalid" };
  if (client.status === "suspended") return { state: "suspended", clientName: client.name };
  return { state: "ok", client: { id: client.id, name: client.name } };
}

export type PortalProjectSummary = {
  id: string;
  name: string;
  baseUrl: string;
  lastAuditAt: Date | null;
  averages: LatestScores["scores"];
  openAlerts: number;
};

/** Solo proyectos en producción y no archivados: lo que se monitorea de verdad. */
async function productionProjects(db: Database, clientId: string) {
  return db
    .select({ id: projects.id, name: projects.name, baseUrl: projects.baseUrl })
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.phase, "production"), isNull(projects.deletedAt)))
    .orderBy(asc(projects.name));
}

export async function getPortalOverview(clientId: string, db: Database = getDb()): Promise<PortalProjectSummary[]> {
  assertUuid(clientId, "Cliente");
  const list = await productionProjects(db, clientId);
  return Promise.all(
    list.map(async (p) => {
      const [latest, alerts] = await Promise.all([getLatestScores(p.id, db), listOpenAlerts(p.id, db)]);
      return {
        ...p,
        lastAuditAt: latest.reduce<Date | null>((max, l) => (max === null || l.finishedAt > max ? l.finishedAt : max), null),
        averages: averageScores(latest),
        openAlerts: alerts.length,
      };
    }),
  );
}

export type PortalProject = {
  id: string;
  name: string;
  baseUrl: string;
  latest: LatestScores[];
  /** Lo que está por debajo de la meta; sin datos internos. */
  improvements: Array<Pick<AlertView, "id" | "kind" | "routePath" | "profile" | "summary" | "openedAt">>;
};

/** null si el proyecto no es de este cliente, no está en producción o está archivado. */
export async function getPortalProject(clientId: string, projectId: string, db: Database = getDb()): Promise<PortalProject | null> {
  assertUuid(clientId, "Cliente");
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const project = (await productionProjects(db, clientId)).find((p) => p.id === projectId);
  if (!project) return null;
  const [latest, alerts] = await Promise.all([getLatestScores(project.id, db), listOpenAlerts(project.id, db)]);
  return {
    ...project,
    latest,
    improvements: alerts.map(({ id, kind, routePath, profile, summary, openedAt }) => ({ id, kind, routePath, profile, summary, openedAt })),
  };
}
