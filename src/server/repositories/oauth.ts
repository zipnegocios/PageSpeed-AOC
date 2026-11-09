import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { oauthClients, oauthCodes } from "@/server/db/schema";

export type OauthClient = typeof oauthClients.$inferSelect;
export type OauthCode = typeof oauthCodes.$inferSelect;

export async function insertClient(db: Database, values: { name: string; redirectUris: string[] }): Promise<OauthClient> {
  const [row] = await db.insert(oauthClients).values(values).returning();
  if (!row) throw new Error("No se pudo registrar la aplicación");
  return row;
}

export async function findClient(db: Database, id: string): Promise<OauthClient | undefined> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, id)).limit(1);
  return row;
}

export async function countClients(db: Database): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(oauthClients);
  return row?.n ?? 0;
}

/** Quita las aplicaciones registradas que nunca se usaron y tienen más de un día. */
export async function purgeUnusedClients(db: Database, olderThan: Date): Promise<void> {
  await db.delete(oauthClients).where(and(isNull(oauthClients.lastUsedAt), lt(oauthClients.createdAt, olderThan)));
}

export async function touchClient(db: Database, id: string, at: Date): Promise<void> {
  await db.update(oauthClients).set({ lastUsedAt: at }).where(eq(oauthClients.id, id));
}

export async function insertCode(db: Database, values: typeof oauthCodes.$inferInsert): Promise<void> {
  await db.insert(oauthCodes).values(values);
}

/** Marca el código como usado solo si seguía sin usar y vigente: dos canjes a la vez no ganan los dos. */
export async function consumeCode(db: Database, codeHash: string, now: Date): Promise<OauthCode | undefined> {
  const [row] = await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthCodes.codeHash, codeHash), isNull(oauthCodes.usedAt), sql`${oauthCodes.expiresAt} > ${now}`))
    .returning();
  return row;
}

/** Limpia los códigos vencidos hace más de un día. */
export async function purgeCodes(db: Database, olderThan: Date): Promise<void> {
  await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, olderThan));
}
