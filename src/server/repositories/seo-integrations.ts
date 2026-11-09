import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { clients, projects, seoIntegrations } from "@/server/db/schema";
import type { SeoKind } from "@/server/domain/seo-connections";

export type SeoIntegration = typeof seoIntegrations.$inferSelect;

export async function listForProject(db: Database, projectId: string): Promise<SeoIntegration[]> {
  return db.select().from(seoIntegrations).where(eq(seoIntegrations.projectId, projectId));
}

export async function listAll(db: Database): Promise<Array<Pick<SeoIntegration, "projectId" | "kind" | "status">>> {
  return db.select({ projectId: seoIntegrations.projectId, kind: seoIntegrations.kind, status: seoIntegrations.status }).from(seoIntegrations);
}

export async function findOne(db: Database, projectId: string, kind: SeoKind): Promise<SeoIntegration | undefined> {
  const [row] = await db
    .select()
    .from(seoIntegrations)
    .where(and(eq(seoIntegrations.projectId, projectId), eq(seoIntegrations.kind, kind)))
    .limit(1);
  return row;
}

/** Crea o reemplaza la conexión. Cambiar el identificador deja el estado en "pendiente" hasta volver a probarla. */
export async function upsert(
  db: Database,
  projectId: string,
  kind: SeoKind,
  value: { externalId: string; /** undefined = conservar la credencial que ya había */ credentialEnc?: Buffer },
): Promise<SeoIntegration> {
  const reset = { externalId: value.externalId, status: "pending" as const, detail: null, lastCheckedAt: null };
  const [row] = await db
    .insert(seoIntegrations)
    .values({ projectId, kind, ...reset, credentialEnc: value.credentialEnc ?? null })
    .onConflictDoUpdate({
      target: [seoIntegrations.projectId, seoIntegrations.kind],
      set: { ...reset, ...(value.credentialEnc ? { credentialEnc: value.credentialEnc } : {}), updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function remove(db: Database, projectId: string, kind: SeoKind): Promise<number> {
  const rows = await db
    .delete(seoIntegrations)
    .where(and(eq(seoIntegrations.projectId, projectId), eq(seoIntegrations.kind, kind)))
    .returning({ id: seoIntegrations.id });
  return rows.length;
}

export async function recordCheck(db: Database, id: string, check: { ok: boolean; detail: string; at: Date }): Promise<void> {
  await db
    .update(seoIntegrations)
    .set({
      status: check.ok ? "ok" : "error",
      detail: check.detail,
      lastCheckedAt: check.at,
      ...(check.ok ? { lastOkAt: check.at } : {}),
      updatedAt: check.at,
    })
    .where(eq(seoIntegrations.id, id));
}

/** Proyectos vigentes (ni archivados ni de un cliente archivado) con conexión a Search Console o GA4: los que se descargan cada día. */
export async function listSyncProjectIds(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ projectId: seoIntegrations.projectId })
    .from(seoIntegrations)
    .innerJoin(projects, eq(projects.id, seoIntegrations.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(inArray(seoIntegrations.kind, ["gsc", "ga4"]), isNull(projects.deletedAt), isNull(clients.deletedAt)));
  return rows.map((r) => r.projectId);
}

/** Anota el avance de una descarga: hasta qué día hay datos y, al terminar, cómo salió. */
export async function recordSync(
  db: Database,
  id: string,
  sync: { status: "ok" | "error"; detail: string; at: Date; syncedThrough?: string },
): Promise<void> {
  await db
    .update(seoIntegrations)
    .set({ syncStatus: sync.status, syncDetail: sync.detail, lastSyncAt: sync.at, ...(sync.syncedThrough ? { syncedThrough: sync.syncedThrough } : {}), updatedAt: sync.at })
    .where(eq(seoIntegrations.id, id));
}

/** Guarda el último día descargado sin tocar el resultado: se llama tras cada ventana para no perder progreso. */
export async function setSyncedThrough(db: Database, id: string, date: string): Promise<void> {
  await db.update(seoIntegrations).set({ syncedThrough: date }).where(eq(seoIntegrations.id, id));
}
