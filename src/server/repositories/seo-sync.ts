import { and, eq, gte, lte } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { seoAiReferralsDaily, seoQueryDaily, seoSearchDaily, seoSourceDaily, seoTrafficDaily } from "@/server/db/schema";
import type { AiRow, QueryRow, SearchRow, SourceRow, TrafficRow } from "@/server/domain/seo-sync";

/** Filas por INSERT: con 8 columnas quedan lejos del límite de parámetros de Postgres (65.535). */
const BATCH = 2000;

/** Solo se guardan filas dentro de la ventana pedida: lo que cayera fuera chocaría con la ventana vecina. */
function within<T extends { date: string }>(rows: T[], from: string, to: string): T[] {
  return rows.filter((r) => r.date >= from && r.date <= to);
}

function batches<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) out.push(rows.slice(i, i + BATCH));
  return out;
}

/**
 * Reemplaza los datos de Search Console de una ventana de fechas por los recién descargados. Borrar e insertar va en una
 * transacción: quien lee ve la ventana vieja o la nueva, nunca a medias, y una descarga repetida deja lo mismo.
 */
export async function replaceSearchWindow(db: Database, projectId: string, from: string, to: string, rows: SearchRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(seoSearchDaily).where(and(eq(seoSearchDaily.projectId, projectId), gte(seoSearchDaily.date, from), lte(seoSearchDaily.date, to)));
    for (const batch of batches(within(rows, from, to))) await tx.insert(seoSearchDaily).values(batch.map((r) => ({ projectId, ...r })));
  });
}

export async function replaceTrafficWindow(db: Database, projectId: string, from: string, to: string, rows: TrafficRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(seoTrafficDaily).where(and(eq(seoTrafficDaily.projectId, projectId), gte(seoTrafficDaily.date, from), lte(seoTrafficDaily.date, to)));
    for (const batch of batches(within(rows, from, to))) await tx.insert(seoTrafficDaily).values(batch.map((r) => ({ projectId, ...r })));
  });
}

export async function replaceAiWindow(db: Database, projectId: string, from: string, to: string, rows: AiRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(seoAiReferralsDaily).where(and(eq(seoAiReferralsDaily.projectId, projectId), gte(seoAiReferralsDaily.date, from), lte(seoAiReferralsDaily.date, to)));
    for (const batch of batches(within(rows, from, to))) await tx.insert(seoAiReferralsDaily).values(batch.map((r) => ({ projectId, ...r })));
  });
}

export async function replaceSourceWindow(db: Database, projectId: string, from: string, to: string, rows: SourceRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(seoSourceDaily).where(and(eq(seoSourceDaily.projectId, projectId), gte(seoSourceDaily.date, from), lte(seoSourceDaily.date, to)));
    for (const batch of batches(within(rows, from, to))) await tx.insert(seoSourceDaily).values(batch.map((r) => ({ projectId, ...r })));
  });
}

export async function replaceQueryWindow(db: Database, projectId: string, from: string, to: string, rows: QueryRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(seoQueryDaily).where(and(eq(seoQueryDaily.projectId, projectId), gte(seoQueryDaily.date, from), lte(seoQueryDaily.date, to)));
    for (const batch of batches(within(rows, from, to))) await tx.insert(seoQueryDaily).values(batch.map((r) => ({ projectId, ...r })));
  });
}
