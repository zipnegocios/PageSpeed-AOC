import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { projects } from "@/server/db/schema";

export async function getClientVisible(db: Database, projectId: string): Promise<{ visible: boolean; phase: "development" | "production" } | null> {
  const [row] = await db.select({ visible: projects.seoClientVisible, phase: projects.phase }).from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
  return row ?? null;
}

export async function setClientVisible(db: Database, projectId: string, visible: boolean): Promise<number> {
  const rows = await db
    .update(projects)
    .set({ seoClientVisible: visible })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .returning({ id: projects.id });
  return rows.length;
}

/** El proyecto, solo si es de este cliente, no está archivado y el administrador activó SEO para él (en producción o en desarrollo). */
export async function findPortalSeoProject(db: Database, clientId: string, projectId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.clientId, clientId), eq(projects.seoClientVisible, true), isNull(projects.deletedAt)))
    .limit(1);
  return row ?? null;
}
