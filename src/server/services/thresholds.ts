import { asc, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { alertThresholds } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { findProject } from "@/server/repositories/projects";
import { thresholdsInput } from "@/server/validation/projects";
import { assertUuid, parseInput } from "./shared";
import { METRICS, type Metric } from "./settings";

export type Threshold = { metric: Metric; minScore: number; enabled: boolean };

export async function getThresholds(projectId: string, db: Database = getDb()): Promise<Threshold[]> {
  assertUuid(projectId, "Proyecto");
  const rows = await db
    .select()
    .from(alertThresholds)
    .where(eq(alertThresholds.projectId, projectId))
    .orderBy(asc(alertThresholds.metric));
  const byMetric = new Map(rows.map((r) => [r.metric, r]));
  return METRICS.flatMap((metric) => {
    const row = byMetric.get(metric);
    return row ? [{ metric, minScore: row.minScore, enabled: row.enabled }] : [];
  });
}

/** Umbrales independientes por proyecto y métrica. Crea o actualiza cada fila indicada. */
export async function setThresholds(projectId: string, raw: unknown, db: Database = getDb()): Promise<Threshold[]> {
  assertUuid(projectId, "Proyecto");
  const input = parseInput(thresholdsInput, raw);
  if (new Set(input.map((t) => t.metric)).size !== input.length) {
    throw new DomainError("INVALID", "Cada métrica solo puede aparecer una vez.");
  }
  if (!(await findProject(db, projectId))) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  await db
    .insert(alertThresholds)
    .values(input.map((t) => ({ projectId, metric: t.metric, minScore: t.minScore, enabled: t.enabled })))
    .onConflictDoUpdate({
      target: [alertThresholds.projectId, alertThresholds.metric],
      set: { minScore: sql`excluded.min_score`, enabled: sql`excluded.enabled`, updatedAt: new Date() },
    });
  return getThresholds(projectId, db);
}
