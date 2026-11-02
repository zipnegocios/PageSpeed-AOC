import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { auditLogs, routes } from "@/server/db/schema";

export type Route = typeof routes.$inferSelect;

export async function listRoutes(db: Database, projectId: string): Promise<Route[]> {
  return db.select().from(routes).where(eq(routes.projectId, projectId)).orderBy(asc(routes.path));
}

export async function findRoute(db: Database, id: string): Promise<Route | undefined> {
  const [row] = await db.select().from(routes).where(eq(routes.id, id)).limit(1);
  return row;
}

export async function findRouteByPath(db: Database, projectId: string, path: string): Promise<Route | undefined> {
  const [row] = await db
    .select()
    .from(routes)
    .where(and(eq(routes.projectId, projectId), eq(routes.path, path)))
    .limit(1);
  return row;
}

export async function updateRoute(
  db: Database,
  id: string,
  values: Partial<typeof routes.$inferInsert>,
): Promise<Route | undefined> {
  const [row] = await db.update(routes).set(values).where(eq(routes.id, id)).returning();
  return row;
}

export async function countRouteAudits(db: Database, routeId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.routeId, routeId));
  return row?.n ?? 0;
}

export async function deleteRoute(db: Database, id: string): Promise<void> {
  await db.delete(routes).where(eq(routes.id, id));
}
