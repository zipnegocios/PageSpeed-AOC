import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { seoCrawlIssues, seoCrawlPages, seoCrawlRuns } from "@/server/db/schema";
import type { PageRow } from "@/server/domain/seo-crawl-rows";
import { summarize, type Issue } from "@/server/domain/seo-crawl-rules";

export type RunRow = typeof seoCrawlRuns.$inferSelect;
export type IssueRow = Pick<typeof seoCrawlIssues.$inferSelect, "page" | "code" | "severity" | "lang" | "evidence">;

/** Rastreos que ya terminaron con páginas y hallazgos guardados. */
const FINISHED = ["succeeded", "partial"] as const;

/** Filas por INSERT: lejos del límite de parámetros de Postgres (65.535) con hasta 19 columnas. */
const BATCH = 500;

function batches<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) out.push(rows.slice(i, i + BATCH));
  return out;
}

/** Crea un rastreo en cola. Falla con violación de unicidad si el proyecto ya tiene uno en cola o en curso. */
export async function createRun(db: Database, projectId: string, trigger: "manual" | "scheduled"): Promise<RunRow> {
  const [row] = await db.insert(seoCrawlRuns).values({ projectId, trigger }).returning();
  return row!;
}

export async function getRun(db: Database, runId: string): Promise<RunRow | null> {
  const [row] = await db.select().from(seoCrawlRuns).where(eq(seoCrawlRuns.id, runId)).limit(1);
  return row ?? null;
}

export async function findActiveRun(db: Database, projectId: string): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(seoCrawlRuns)
    .where(and(eq(seoCrawlRuns.projectId, projectId), inArray(seoCrawlRuns.status, ["queued", "running"])))
    .limit(1);
  return row ?? null;
}

/** De «en cola» a «en curso». Devuelve false si el rastreo ya no estaba en cola (otro trabajo lo tomó o lo canceló). */
export async function markRunning(db: Database, runId: string, limits: Record<string, number>): Promise<boolean> {
  const rows = await db
    .update(seoCrawlRuns)
    .set({ status: "running", startedAt: new Date(), limits })
    .where(and(eq(seoCrawlRuns.id, runId), eq(seoCrawlRuns.status, "queued")))
    .returning({ id: seoCrawlRuns.id });
  return rows.length > 0;
}

export type RunResult = {
  status: "succeeded" | "partial" | "failed";
  outcome: string;
  detail: string | null;
  pagesCrawled: number;
  pagesDiscovered: number;
  requests: number;
  truncatedBy: string | null;
};

/**
 * Cierra un rastreo con sus páginas y hallazgos en una sola transacción: quien lee ve el rastreo anterior o este completo,
 * nunca a medias. Solo se guardan páginas y hallazgos si el rastreo terminó (`succeeded` o `partial`). Cierra solo un
 * rastreo en curso: devuelve false (y no escribe nada) si ya estaba cerrado, por ejemplo por la reconciliación.
 */
export async function finishRun(db: Database, runId: string, result: RunResult, pages: PageRow[], issues: Issue[]): Promise<boolean> {
  const keep = result.status !== "failed";
  const counts = summarize(keep ? issues : []);
  return db.transaction(async (tx) => {
    const [closed] = await tx
      .update(seoCrawlRuns)
      .set({
        status: result.status,
        finishedAt: new Date(),
        outcome: result.outcome,
        detail: result.detail,
        pagesCrawled: result.pagesCrawled,
        pagesDiscovered: result.pagesDiscovered,
        requests: result.requests,
        truncatedBy: result.truncatedBy,
        errors: counts.error,
        warnings: counts.warning,
        infos: counts.info,
      })
      .where(and(eq(seoCrawlRuns.id, runId), eq(seoCrawlRuns.status, "running")))
      .returning({ id: seoCrawlRuns.id });
    if (!closed) return false;
    if (keep) {
      for (const batch of batches(pages)) await tx.insert(seoCrawlPages).values(batch.map((p) => ({ runId, ...p })));
      for (const batch of batches(issues)) {
        await tx.insert(seoCrawlIssues).values(batch.map((i) => ({ runId, page: i.page, code: i.code, severity: i.severity, lang: i.lang, evidence: i.evidence })));
      }
    }
    return true;
  });
}

/** Marca como fallido un rastreo en cola o en curso. No toca uno que ya terminó. */
export async function failRun(db: Database, runId: string, detail: string, outcome = "error"): Promise<boolean> {
  const rows = await db
    .update(seoCrawlRuns)
    .set({ status: "failed", finishedAt: new Date(), outcome, detail })
    .where(and(eq(seoCrawlRuns.id, runId), inArray(seoCrawlRuns.status, ["queued", "running"])))
    .returning({ id: seoCrawlRuns.id });
  return rows.length > 0;
}

/** Rastreos «en curso» desde antes de `startedBefore` (o «en cola» desde antes de `queuedBefore`): el trabajo se perdió. */
export async function failStaleRuns(db: Database, startedBefore: Date, queuedBefore: Date, detail: string): Promise<number> {
  const rows = await db
    .update(seoCrawlRuns)
    .set({ status: "failed", finishedAt: new Date(), outcome: "stale", detail })
    .where(
      sql`(${seoCrawlRuns.status} = 'running' and ${seoCrawlRuns.startedAt} < ${startedBefore}) or (${seoCrawlRuns.status} = 'queued' and ${seoCrawlRuns.queuedAt} < ${queuedBefore})`,
    )
    .returning({ id: seoCrawlRuns.id });
  return rows.length;
}

/** Los últimos rastreos de un proyecto, del más reciente al más antiguo, de cualquier estado. */
export async function listRuns(db: Database, projectId: string, limit: number): Promise<RunRow[]> {
  return db.select().from(seoCrawlRuns).where(eq(seoCrawlRuns.projectId, projectId)).orderBy(desc(seoCrawlRuns.queuedAt)).limit(limit);
}

/** Los últimos rastreos terminados con datos (`succeeded` o `partial`), del más reciente al más antiguo. */
export async function listFinishedRuns(db: Database, projectId: string, limit: number): Promise<RunRow[]> {
  return db
    .select()
    .from(seoCrawlRuns)
    .where(and(eq(seoCrawlRuns.projectId, projectId), inArray(seoCrawlRuns.status, [...FINISHED])))
    .orderBy(desc(seoCrawlRuns.queuedAt))
    .limit(limit);
}

export async function listIssues(db: Database, runId: string): Promise<IssueRow[]> {
  return db
    .select({ page: seoCrawlIssues.page, code: seoCrawlIssues.code, severity: seoCrawlIssues.severity, lang: seoCrawlIssues.lang, evidence: seoCrawlIssues.evidence })
    .from(seoCrawlIssues)
    .where(eq(seoCrawlIssues.runId, runId))
    .orderBy(seoCrawlIssues.code, seoCrawlIssues.page);
}

export async function listPages(db: Database, runId: string) {
  return db.select().from(seoCrawlPages).where(eq(seoCrawlPages.runId, runId)).orderBy(seoCrawlPages.path);
}

/**
 * Conserva las páginas y los hallazgos de los últimos `keep` rastreos terminados de un proyecto. De los anteriores solo
 * queda la fila del rastreo con sus conteos, que alcanza para dibujar la tendencia. Devuelve cuántos rastreos se podaron.
 */
export async function pruneRuns(db: Database, projectId: string, keep: number): Promise<number> {
  const old = await db
    .select({ id: seoCrawlRuns.id })
    .from(seoCrawlRuns)
    .where(and(eq(seoCrawlRuns.projectId, projectId), inArray(seoCrawlRuns.status, [...FINISHED])))
    .orderBy(desc(seoCrawlRuns.queuedAt))
    .offset(keep);
  if (old.length === 0) return 0;
  const ids = old.map((r) => r.id);
  return db.transaction(async (tx) => {
    const pages = await tx.delete(seoCrawlPages).where(inArray(seoCrawlPages.runId, ids)).returning({ runId: seoCrawlPages.runId });
    const issues = await tx.delete(seoCrawlIssues).where(inArray(seoCrawlIssues.runId, ids)).returning({ runId: seoCrawlIssues.runId });
    return new Set([...pages, ...issues].map((r) => r.runId)).size;
  });
}

/** Proyectos con un rastreo en cola o en curso, para no encolar otro desde el agendador. */
export async function projectsWithActiveRun(db: Database, projectIds: string[]): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const rows = await db
    .select({ projectId: seoCrawlRuns.projectId })
    .from(seoCrawlRuns)
    .where(and(inArray(seoCrawlRuns.projectId, projectIds), inArray(seoCrawlRuns.status, ["queued", "running"])));
  return new Set(rows.map((r) => r.projectId));
}
