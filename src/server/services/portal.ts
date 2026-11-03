import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { isValidSlug } from "@/server/domain/slug";
import { findClientBySlug, findClientByToken } from "@/server/repositories/clients";
import { listOpenAlerts, type AlertView } from "./alerts";
import { averageScores, getLatestScores, type LatestScores } from "./history";
import { assertUuid } from "./shared";
import { getAudit, type AuditDetail } from "./audits";
import { getRoute } from "./routes";

/** El token es de 32 bytes en base64url: 43 caracteres. Todo lo demás se descarta sin tocar la base de datos. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isPlausibleToken = (token: string) => TOKEN_RE.test(token);

export type PortalClient = { id: string; name: string };

export type PortalAccess =
  | { state: "invalid" }
  | { state: "suspended"; clientName: string }
  | { state: "ok"; client: PortalClient };

/**
 * Resuelve el enlace del portal. Hay dos formas: el link privado (token de 43 caracteres, rotable) y el link fijo con el
 * identificador del cliente (hasta 40 caracteres, así que no se confunden). Un identificador anterior también vale.
 * Se comprueba en cada petición: rotar el token o suspender al cliente surte efecto al instante.
 */
export async function resolvePortal(ref: string, db: Database = getDb()): Promise<PortalAccess> {
  const client = isPlausibleToken(ref) ? await findClientByToken(db, ref) : isValidSlug(ref) ? await findClientBySlug(db, ref) : undefined;
  if (!client) return { state: "invalid" };
  if (client.status === "suspended") return { state: "suspended", clientName: client.name };
  return { state: "ok", client: { id: client.id, name: client.name } };
}

export type PortalProjectSummary = {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  lastAuditAt: Date | null;
  averages: LatestScores["scores"];
  openAlerts: number;
};

/** Solo proyectos en producción y no archivados: lo que se monitorea de verdad. */
async function productionProjects(db: Database, clientId: string) {
  return db
    .select({ id: projects.id, slug: projects.slug, slugAliases: projects.slugAliases, name: projects.name, baseUrl: projects.baseUrl })
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
  slug: string;
  name: string;
  baseUrl: string;
  latest: LatestScores[];
  /** Lo que está por debajo de la meta; sin datos internos. */
  improvements: Array<Pick<AlertView, "id" | "kind" | "routePath" | "profile" | "summary" | "openedAt">>;
};

/**
 * null si el proyecto no es de este cliente, no está en producción o está archivado. `ref` es el identificador
 * legible (slug) del proyecto o, para enlaces antiguos, su UUID.
 */
export async function getPortalProject(clientId: string, ref: string, db: Database = getDb()): Promise<PortalProject | null> {
  assertUuid(clientId, "Cliente");
  const found = (await productionProjects(db, clientId)).find((p) => p.slug === ref || p.slugAliases.includes(ref) || p.id === ref);
  const project = found ? { id: found.id, slug: found.slug, name: found.name, baseUrl: found.baseUrl } : undefined;
  if (!project) return null;
  const [latest, alerts] = await Promise.all([getLatestScores(project.id, db), listOpenAlerts(project.id, db)]);
  return {
    ...project,
    latest,
    improvements: alerts.map(({ id, kind, routePath, profile, summary, openedAt }) => ({ id, kind, routePath, profile, summary, openedAt })),
  };
}

export type PortalAudit = {
  audit: AuditDetail;
  /** Identificador legible del proyecto, para armar los enlaces. */
  projectSlug: string;
  /** La ruta exige sesión: al cliente no se le muestran capturas ni fragmentos de HTML. */
  redact: boolean;
};

/** Auditoría correcta de un proyecto del cliente. null si no existe, no es suya o no terminó bien. */
export async function getPortalAudit(clientId: string, projectId: string, auditId: string, db: Database = getDb()): Promise<PortalAudit | null> {
  if (!/^[0-9a-f-]{36}$/i.test(auditId)) return null;
  const project = await getPortalProject(clientId, projectId, db);
  if (!project) return null;
  try {
    const audit = await getAudit(auditId, db);
    if (audit.projectId !== project.id || audit.status !== "succeeded") return null;
    const route = await getRoute(audit.routeId, db);
    return { audit, projectSlug: project.slug, redact: route.requiresAuth };
  } catch {
    return null;
  }
}
