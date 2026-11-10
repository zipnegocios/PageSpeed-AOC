import { and, asc, count, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { alertStates, auditLogs, clientReportSends, clients, projectActions, projects, routes, serverChecks } from "@/server/db/schema";
import type { Client } from "./clients";
import type { Project } from "./projects";

export type ProjectAction = typeof projectActions.$inferSelect;
export type ReportSend = typeof clientReportSends.$inferSelect;
export type ReportKind = "weekly" | "monthly";

// ------------------------------------------------------------ preferencias

export async function setClientReportFlags(db: Database, id: string, flags: { reportWeekly: boolean; reportMonthly: boolean }): Promise<void> {
  await db.update(clients).set(flags).where(and(eq(clients.id, id), isNull(clients.deletedAt)));
}

/** Proyectos en producción de clientes activos con correo de contacto y algún correo automático encendido. */
export async function listReportCandidates(db: Database): Promise<Array<{ project: Project; client: Client }>> {
  const rows = await db
    .select({ project: projects, client: clients })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        isNull(projects.deletedAt),
        isNull(clients.deletedAt),
        eq(projects.phase, "production"),
        eq(clients.status, "active"),
        or(eq(clients.reportWeekly, true), eq(clients.reportMonthly, true)),
        sql`coalesce(trim(${clients.contactEmail}), '') <> ''`,
      ),
    )
    .orderBy(asc(clients.name), asc(projects.name));
  return rows;
}

// ------------------------------------------------------------------ auditorías

export type ProfileScores = { audits: number; performance: number | null; seo: number | null; accessibility: number | null };

/** Promedio de las notas de las auditorías correctas en producción de un periodo, por perfil. */
export async function monthScores(db: Database, projectId: string, range: { from: string; to: string }): Promise<Record<"mobile" | "desktop", ProfileScores>> {
  const rows = await db
    .select({
      profile: auditLogs.profile,
      audits: count(),
      performance: sql<number | null>`avg(${auditLogs.scorePerformance})::double precision`,
      seo: sql<number | null>`avg(${auditLogs.scoreSeo})::double precision`,
      accessibility: sql<number | null>`avg(${auditLogs.scoreAccessibility})::double precision`,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.projectId, projectId),
        eq(auditLogs.status, "succeeded"),
        eq(auditLogs.phaseAtRun, "production"),
        gte(auditLogs.finishedAt, sql`${range.from}::date`),
        lt(auditLogs.finishedAt, sql`(${range.to}::date + 1)`),
      ),
    )
    .groupBy(auditLogs.profile);
  const empty: ProfileScores = { audits: 0, performance: null, seo: null, accessibility: null };
  const out = { mobile: { ...empty }, desktop: { ...empty } };
  for (const r of rows) out[r.profile] = { audits: Number(r.audits), performance: r.performance, seo: r.seo, accessibility: r.accessibility };
  return out;
}

export async function countOpenAlerts(db: Database, projectId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(alertStates).where(and(eq(alertStates.projectId, projectId), eq(alertStates.status, "open")));
  return Number(row?.n ?? 0);
}

/** Páginas que el sitemap aportó en el periodo y que ya se vigilan. */
export async function countNewMonitoredRoutes(db: Database, projectId: string, range: { from: string; to: string }): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(routes)
    .where(
      and(
        eq(routes.projectId, projectId),
        eq(routes.source, "sitemap"),
        eq(routes.monitored, true),
        gte(routes.createdAt, sql`${range.from}::date`),
        lt(routes.createdAt, sql`(${range.to}::date + 1)`),
      ),
    );
  return Number(row?.n ?? 0);
}

// ------------------------------------------------------ registro de actuaciones

export function listActionsBetween(db: Database, projectId: string, range: { from: string; to: string }): Promise<ProjectAction[]> {
  return db
    .select()
    .from(projectActions)
    .where(and(eq(projectActions.projectId, projectId), gte(projectActions.happenedOn, range.from), sql`${projectActions.happenedOn} <= ${range.to}`))
    .orderBy(asc(projectActions.happenedOn), asc(projectActions.createdAt));
}

export function listRecentActions(db: Database, projectId: string, limit: number): Promise<ProjectAction[]> {
  return db.select().from(projectActions).where(eq(projectActions.projectId, projectId)).orderBy(desc(projectActions.happenedOn), desc(projectActions.createdAt)).limit(limit);
}

export async function insertAction(db: Database, values: { projectId: string; happenedOn: string; text: string }): Promise<void> {
  await db.insert(projectActions).values(values);
}

export async function deleteAction(db: Database, projectId: string, id: string): Promise<boolean> {
  const rows = await db.delete(projectActions).where(and(eq(projectActions.id, id), eq(projectActions.projectId, projectId))).returning({ id: projectActions.id });
  return rows.length > 0;
}

// ---------------------------------------------------------- revisión del servidor

export async function hasServerCheck(db: Database, projectId: string, month: string): Promise<boolean> {
  const rows = await db.select({ m: serverChecks.month }).from(serverChecks).where(and(eq(serverChecks.projectId, projectId), eq(serverChecks.month, month))).limit(1);
  return rows.length > 0;
}

export async function setServerCheck(db: Database, projectId: string, month: string, at: Date): Promise<void> {
  await db.insert(serverChecks).values({ projectId, month, checkedAt: at }).onConflictDoUpdate({ target: [serverChecks.projectId, serverChecks.month], set: { checkedAt: at } });
}

export async function listServerChecks(db: Database, projectId: string, limit: number): Promise<string[]> {
  const rows = await db.select({ m: serverChecks.month }).from(serverChecks).where(eq(serverChecks.projectId, projectId)).orderBy(desc(serverChecks.month)).limit(limit);
  return rows.map((r) => r.m);
}

// ------------------------------------------------------------------- envíos

export async function findSend(db: Database, projectId: string, kind: ReportKind, periodKey: string): Promise<ReportSend | undefined> {
  const [row] = await db
    .select()
    .from(clientReportSends)
    .where(and(eq(clientReportSends.projectId, projectId), eq(clientReportSends.kind, kind), eq(clientReportSends.periodKey, periodKey)))
    .limit(1);
  return row;
}

export async function recordSend(db: Database, values: { projectId: string; kind: ReportKind; periodKey: string; status: "sent" | "failed" | "skipped"; detail?: string | null; at: Date }): Promise<void> {
  const row = { projectId: values.projectId, kind: values.kind, periodKey: values.periodKey, status: values.status, detail: values.detail ?? null, sentAt: values.at };
  await db
    .insert(clientReportSends)
    .values(row)
    .onConflictDoUpdate({ target: [clientReportSends.projectId, clientReportSends.kind, clientReportSends.periodKey], set: { status: row.status, detail: row.detail, sentAt: row.sentAt } });
}

export function listSends(db: Database, projectId: string, limit: number): Promise<ReportSend[]> {
  return db.select().from(clientReportSends).where(eq(clientReportSends.projectId, projectId)).orderBy(desc(clientReportSends.sentAt)).limit(limit);
}
