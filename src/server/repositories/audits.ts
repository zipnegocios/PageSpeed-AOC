import { and, desc, eq, getTableColumns, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { auditLogs, clients, projects, routes } from "@/server/db/schema";
import type { AuditMetrics } from "@/server/domain/score-extraction";

export type AuditLog = typeof auditLogs.$inferSelect;
export type AuditWithRoute = AuditLog & { routePath: string };
export type AuditDetail = AuditWithRoute & { projectName: string; projectSlug: string; clientId: string; clientName: string; clientSlug: string };

/** Todo lo que el worker necesita para ejecutar una auditoría. */
export type AuditContext = {
  audit: AuditLog;
  route: typeof routes.$inferSelect;
  project: typeof projects.$inferSelect;
  clientSlug: string;
};

export async function listRecentAudits(db: Database, projectId: string, limit: number): Promise<AuditWithRoute[]> {
  const rows = await db
    .select({ audit: auditLogs, routePath: routes.path })
    .from(auditLogs)
    .innerJoin(routes, eq(routes.id, auditLogs.routeId))
    .where(eq(auditLogs.projectId, projectId))
    .orderBy(desc(auditLogs.queuedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.audit, routePath: r.routePath }));
}

export async function findAuditDetail(db: Database, id: string): Promise<AuditDetail | undefined> {
  const [row] = await db
    .select({
      audit: auditLogs,
      routePath: routes.path,
      projectName: projects.name,
      projectSlug: projects.slug,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
    })
    .from(auditLogs)
    .innerJoin(routes, eq(routes.id, auditLogs.routeId))
    .innerJoin(projects, eq(projects.id, auditLogs.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(auditLogs.id, id))
    .limit(1);
  return row
    ? { ...row.audit, routePath: row.routePath, projectName: row.projectName, projectSlug: row.projectSlug, clientId: row.clientId, clientName: row.clientName, clientSlug: row.clientSlug }
    : undefined;
}

export async function findAuditContext(db: Database, id: string): Promise<AuditContext | undefined> {
  const [row] = await db
    .select({ audit: auditLogs, route: routes, project: projects, clientSlug: clients.slug })
    .from(auditLogs)
    .innerJoin(routes, eq(routes.id, auditLogs.routeId))
    .innerJoin(projects, eq(projects.id, auditLogs.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(auditLogs.id, id))
    .limit(1);
  return row;
}

export async function findPending(db: Database, routeId: string, profile: "mobile" | "desktop"): Promise<AuditLog | undefined> {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.routeId, routeId), eq(auditLogs.profile, profile), inArray(auditLogs.status, ["queued", "running"])))
    .limit(1);
  return row;
}

/** Qué ruta y dispositivo de un proyecto ya tienen una auditoría correcta o pendiente (para el primer escaneo). */
export async function listCoveredProfiles(
  db: Database,
  projectId: string,
): Promise<{ routeId: string; profile: "mobile" | "desktop"; state: "succeeded" | "pending" }[]> {
  const rows = await db
    .selectDistinct({ routeId: auditLogs.routeId, profile: auditLogs.profile, status: auditLogs.status })
    .from(auditLogs)
    .where(and(eq(auditLogs.projectId, projectId), inArray(auditLogs.status, ["succeeded", "queued", "running"])));
  return rows.map((r) => ({ routeId: r.routeId, profile: r.profile, state: r.status === "succeeded" ? ("succeeded" as const) : ("pending" as const) }));
}

export async function insertAudit(db: Database, values: typeof auditLogs.$inferInsert): Promise<AuditLog> {
  const [row] = await db.insert(auditLogs).values(values).returning();
  if (!row) throw new Error("No se pudo crear la auditoría");
  return row;
}

export async function markRunning(db: Database, id: string, attempts: number): Promise<void> {
  await db
    .update(auditLogs)
    .set({ status: "running", attempts, startedAt: new Date(), finishedAt: null, durationMs: null })
    .where(eq(auditLogs.id, id));
}

/** Falló un intento y quedan más: vuelve a la cola conservando el último error. */
export async function markRetry(db: Database, id: string, error: { code: string; message: string }): Promise<void> {
  await db
    .update(auditLogs)
    .set({ status: "queued", errorCode: error.code, errorMessage: error.message })
    .where(eq(auditLogs.id, id));
}

export async function markSucceeded(db: Database, id: string, metrics: AuditMetrics, r2Key: string): Promise<void> {
  await db
    .update(auditLogs)
    .set({
      status: "succeeded",
      errorCode: null,
      errorMessage: null,
      scorePerformance: metrics.scorePerformance,
      scoreSeo: metrics.scoreSeo,
      scoreAccessibility: metrics.scoreAccessibility,
      scoreBestPractices: metrics.scoreBestPractices,
      lcpMs: metrics.lcpMs,
      cls: metrics.cls,
      tbtMs: metrics.tbtMs,
      fcpMs: metrics.fcpMs,
      ttfbMs: metrics.ttfbMs,
      inpMs: metrics.inpMs,
      agenticPassed: metrics.agenticPassed,
      agenticTotal: metrics.agenticTotal,
      lighthouseVersion: metrics.lighthouseVersion,
      finalUrl: metrics.finalUrl,
      httpStatus: metrics.httpStatus,
      r2Key,
      finishedAt: new Date(),
      durationMs: sql`(extract(epoch from (now() - ${auditLogs.startedAt})) * 1000)::int`,
    })
    .where(eq(auditLogs.id, id));
}

export async function markFailed(db: Database, id: string, error: { code: string; message: string }): Promise<void> {
  await db
    .update(auditLogs)
    .set({
      status: "failed",
      errorCode: error.code,
      errorMessage: error.message,
      finishedAt: new Date(),
      durationMs: sql`case when ${auditLogs.startedAt} is null then null else (extract(epoch from (now() - ${auditLogs.startedAt})) * 1000)::int end`,
    })
    .where(eq(auditLogs.id, id));
}

/** Auditorías "en curso" que empezaron antes de `before`: candidatas a haber quedado huérfanas. */
export async function listStaleRunning(db: Database, before: Date): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.status, "running"), lt(auditLogs.startedAt, before)));
}

/** Auditorías en cola desde antes de `before`: deberían tener ya su trabajo en Redis. */
export async function listQueuedBefore(db: Database, before: Date): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.status, "queued"), lt(auditLogs.queuedAt, before)));
}

/** Vuelve a dejar en cola una auditoría que figuraba como en curso (el trabajo sigue pendiente). */
export async function markRequeued(db: Database, id: string): Promise<void> {
  await db.update(auditLogs).set({ status: "queued", startedAt: null }).where(eq(auditLogs.id, id));
}

/**
 * Borra las auditorías programadas de un proyecto que aún no empezaron (nunca corrieron, así que
 * no hay historial que conservar) y devuelve sus ids para retirar los trabajos de la cola.
 */
export async function deleteQueuedScheduled(db: Database, projectId: string): Promise<string[]> {
  const rows = await db
    .delete(auditLogs)
    .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.trigger, "scheduled"), eq(auditLogs.status, "queued")))
    .returning({ id: auditLogs.id });
  return rows.map((r) => r.id);
}

export type FailedAudit = AuditWithRoute & { projectName: string };

export async function listRecentFailures(db: Database, limit: number): Promise<FailedAudit[]> {
  const rows = await db
    .select({ audit: auditLogs, routePath: routes.path, projectName: projects.name })
    .from(auditLogs)
    .innerJoin(routes, eq(routes.id, auditLogs.routeId))
    .innerJoin(projects, eq(projects.id, auditLogs.projectId))
    .where(eq(auditLogs.status, "failed"))
    .orderBy(desc(auditLogs.finishedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.audit, routePath: r.routePath, projectName: r.projectName }));
}

/**
 * Las últimas `n` auditorías (de cualquier estado) por ruta y dispositivo de un proyecto, la más reciente primero. La
 * ventana es por ruta y perfil, así que el tamaño total está acotado por rutas x 2 x n sin importar cuánto historial haya.
 */
export async function listRecentPerRouteProfile(db: Database, projectId: string, n: number): Promise<AuditWithRoute[]> {
  const ranked = db
    .select({
      ...getTableColumns(auditLogs),
      routePath: routes.path,
      rank: sql<number>`row_number() over (partition by ${auditLogs.routeId}, ${auditLogs.profile} order by ${auditLogs.queuedAt} desc)`.as("rank"),
    })
    .from(auditLogs)
    .innerJoin(routes, eq(routes.id, auditLogs.routeId))
    .where(eq(auditLogs.projectId, projectId))
    .as("ranked");
  const rows = await db.select().from(ranked).where(lte(ranked.rank, n)).orderBy(desc(ranked.queuedAt));
  return rows.map(({ rank: _rank, ...r }) => r as unknown as AuditWithRoute);
}

export type SiblingRow = { id: string; profile: "mobile" | "desktop"; finishedAt: Date; scorePerformance: number | null };

/** La última auditoría correcta de cada dispositivo de una ruta (a lo sumo una por dispositivo). */
export async function listLatestByRoute(db: Database, routeId: string): Promise<SiblingRow[]> {
  const rows = await db
    .selectDistinctOn([auditLogs.profile], { id: auditLogs.id, profile: auditLogs.profile, finishedAt: auditLogs.finishedAt, scorePerformance: auditLogs.scorePerformance })
    .from(auditLogs)
    .where(and(eq(auditLogs.routeId, routeId), eq(auditLogs.status, "succeeded"), isNotNull(auditLogs.finishedAt)))
    .orderBy(auditLogs.profile, desc(auditLogs.finishedAt));
  return rows.flatMap((r) => (r.finishedAt ? [{ ...r, finishedAt: r.finishedAt }] : []));
}
