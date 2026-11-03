import { desc, eq, isNull, and, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { mcpApiKeys } from "@/server/db/schema";

export type ApiKeyRow = typeof mcpApiKeys.$inferSelect;

export async function insertApiKey(db: Database, values: { name: string; keyHash: string; scopes: string[] }): Promise<ApiKeyRow> {
  const [row] = await db.insert(mcpApiKeys).values(values).returning();
  if (!row) throw new Error("No se pudo crear la clave");
  return row;
}

export function listApiKeys(db: Database): Promise<ApiKeyRow[]> {
  return db.select().from(mcpApiKeys).orderBy(desc(mcpApiKeys.createdAt));
}

export async function findActiveByHash(db: Database, keyHash: string): Promise<ApiKeyRow | undefined> {
  const [row] = await db
    .select()
    .from(mcpApiKeys)
    .where(and(eq(mcpApiKeys.keyHash, keyHash), isNull(mcpApiKeys.revokedAt)))
    .limit(1);
  return row;
}

export async function revokeKey(db: Database, id: string, at: Date): Promise<boolean> {
  const rows = await db
    .update(mcpApiKeys)
    .set({ revokedAt: at })
    .where(and(eq(mcpApiKeys.id, id), isNull(mcpApiKeys.revokedAt)))
    .returning({ id: mcpApiKeys.id });
  return rows.length > 0;
}

/** Marca el uso solo si pasó más de `minGapMs`: una clave muy activa no escribe en cada llamada. */
export async function touchKey(db: Database, id: string, at: Date, minGapMs: number): Promise<void> {
  await db
    .update(mcpApiKeys)
    .set({ lastUsedAt: at })
    .where(and(eq(mcpApiKeys.id, id), sql`(${mcpApiKeys.lastUsedAt} is null or ${mcpApiKeys.lastUsedAt} < ${new Date(at.getTime() - minGapMs)})`));
}
