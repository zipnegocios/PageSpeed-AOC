import type { Scope } from "@/server/domain/access";
import { scopeWhere } from "./scope";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { adminUsers, alertStates, alertThresholds, auditLogs, clients, notifications, projects, routes } from "@/server/db/schema";

export type AlertState = typeof alertStates.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Threshold = typeof alertThresholds.$inferSelect;

export function listThresholds(db: Database, projectId: string): Promise<Threshold[]> {
  return db.select().from(alertThresholds).where(eq(alertThresholds.projectId, projectId));
}

export function listOpenStatesForRoute(db: Database, routeId: string, profile: "mobile" | "desktop"): Promise<AlertState[]> {
  return db
    .select()
    .from(alertStates)
    .where(and(eq(alertStates.routeId, routeId), eq(alertStates.profile, profile), eq(alertStates.status, "open")));
}

export type OpenAlertRow = {
  state: AlertState;
  routePath: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  /** Código de error de la auditoría que abrió un fallo (null en alertas de umbral). */
  errorCode: string | null;
};

const openAlertColumns = {
  state: alertStates,
  routePath: routes.path,
  projectId: projects.id,
  projectName: projects.name,
  projectSlug: projects.slug,
  clientId: clients.id,
  clientName: clients.name,
  clientSlug: clients.slug,
  errorCode: auditLogs.errorCode,
};

/** Alertas abiertas de proyectos en producción (las de desarrollo están suprimidas). */
export function listOpenAlerts(db: Database, filter: { projectId?: string; scope?: Scope } = {}): Promise<OpenAlertRow[]> {
  return db
    .select(openAlertColumns)
    .from(alertStates)
    .innerJoin(routes, eq(routes.id, alertStates.routeId))
    .innerJoin(projects, eq(projects.id, alertStates.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(auditLogs, eq(auditLogs.id, alertStates.openedByAuditId))
    .where(
      and(
        eq(alertStates.status, "open"),
        eq(projects.phase, "production"),
        isNull(projects.deletedAt),
        isNull(clients.deletedAt),
        filter.projectId ? eq(alertStates.projectId, filter.projectId) : undefined,
        scopeWhere(filter.scope, projects.id, projects.clientId),
      ),
    )
    .orderBy(asc(clients.name), asc(projects.name), asc(routes.path), asc(alertStates.openedAt));
}

/**
 * Correo del responsable de cada proyecto, solo cuando el responsable es otra persona del equipo (no la cuenta
 * propietaria): a esos clientes les avisa quien los atiende. El resto sigue el destinatario general.
 */
export async function ownerAlertRecipients(db: Database, projectIds: string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: projects.id, email: adminUsers.email, role: adminUsers.role })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(adminUsers, eq(adminUsers.id, clients.ownerId))
    .where(inArray(projects.id, projectIds));
  return new Map(rows.filter((r) => r.role !== "owner").map((r) => [r.projectId, r.email]));
}

/** Proyectos que tienen auditorías en cola o en curso encoladas después de `since`. */
export async function projectsWithPendingAudits(db: Database, projectIds: string[], since: Date): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ projectId: auditLogs.projectId })
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.projectId, projectIds),
        inArray(auditLogs.status, ["queued", "running"]),
        gt(auditLogs.queuedAt, since),
      ),
    );
  return new Set(rows.map((r) => r.projectId));
}

/** Proyectos con un envío fallido posterior a `since` (para no reintentar en cada barrido). */
export async function projectsWithRecentFailedNotification(db: Database, projectIds: string[], since: Date): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ projectId: notifications.projectId })
    .from(notifications)
    .where(and(inArray(notifications.projectId, projectIds), eq(notifications.status, "failed"), gt(notifications.sentAt, since)));
  return new Set(rows.map((r) => r.projectId));
}

export async function insertNotification(db: Database, values: typeof notifications.$inferInsert): Promise<void> {
  await db.insert(notifications).values(values);
}

/** Registra el aviso: fija la fecha y suma un recordatorio a las que ya se habían avisado. */
export async function markNotified(db: Database, ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(alertStates)
    .set({
      lastNotifiedAt: at,
      reminderCount: sql`case when ${alertStates.lastNotifiedAt} is null then 0 else ${alertStates.reminderCount} + 1 end`,
    })
    .where(inArray(alertStates.id, ids));
}

export type NotificationRow = Notification & { projectName: string; clientName: string };

export function listRecentNotifications(db: Database, limit: number, projectId?: string, scope?: Scope): Promise<NotificationRow[]> {
  return db
    .select({ n: notifications, projectName: projects.name, clientName: clients.name })
    .from(notifications)
    .innerJoin(projects, eq(projects.id, notifications.projectId))
    .innerJoin(clients, eq(clients.id, notifications.clientId))
    .where(and(projectId ? eq(notifications.projectId, projectId) : undefined, scopeWhere(scope, projects.id, projects.clientId)))
    .orderBy(desc(notifications.sentAt))
    .limit(limit)
    .then((rows) => rows.map((r) => ({ ...r.n, projectName: r.projectName, clientName: r.clientName })));
}
