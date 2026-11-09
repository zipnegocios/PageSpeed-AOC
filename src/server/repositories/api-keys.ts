import { desc, eq, isNotNull, isNull, and, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { mcpApiKeys } from "@/server/db/schema";

export type ApiKeyRow = typeof mcpApiKeys.$inferSelect;

export async function insertApiKey(
  db: Database,
  values: {
    name: string;
    keyHash: string;
    scopes: string[];
    allAccess: boolean;
    clientIds: string[];
    projectIds: string[];
    oauthClientId?: string;
    expiresAt?: Date;
    refreshHash?: string;
    refreshExpiresAt?: Date;
  },
): Promise<ApiKeyRow> {
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

export type ApiKeyChanges = { name: string; scopes: string[]; allAccess: boolean; clientIds: string[]; projectIds: string[] };

/** Cambia el nombre, los permisos y el alcance de una clave activa. false si no existe o ya está revocada. */
export async function updateKey(db: Database, id: string, changes: ApiKeyChanges): Promise<ApiKeyRow | undefined> {
  const [row] = await db
    .update(mcpApiKeys)
    .set(changes)
    .where(and(eq(mcpApiKeys.id, id), isNull(mcpApiKeys.revokedAt)))
    .returning();
  return row;
}

/** Cambia el secreto de una clave activa (la huella anterior deja de existir). */
export async function rotateKeyHash(db: Database, id: string, keyHash: string, at: Date): Promise<ApiKeyRow | undefined> {
  const [row] = await db
    .update(mcpApiKeys)
    .set({ keyHash, rotatedAt: at, lastUsedAt: null })
    .where(and(eq(mcpApiKeys.id, id), isNull(mcpApiKeys.revokedAt)))
    .returning();
  return row;
}

export async function findKey(db: Database, id: string): Promise<ApiKeyRow | undefined> {
  const [row] = await db.select().from(mcpApiKeys).where(eq(mcpApiKeys.id, id)).limit(1);
  return row;
}

/** Borra la fila solo si ya está revocada (la condición va en el `where` para que no haya carrera con una rotación). */
export async function deleteRevoked(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .delete(mcpApiKeys)
    .where(and(eq(mcpApiKeys.id, id), isNotNull(mcpApiKeys.revokedAt)))
    .returning({ id: mcpApiKeys.id });
  return rows.length > 0;
}

export async function findActiveByRefreshHash(db: Database, refreshHash: string): Promise<ApiKeyRow | undefined> {
  const [row] = await db.select().from(mcpApiKeys).where(and(eq(mcpApiKeys.refreshHash, refreshHash), isNull(mcpApiKeys.revokedAt))).limit(1);
  return row;
}

/** Una conexión cuyo refresco ya gastado se vuelve a presentar: señal de robo, se revoca toda la conexión. */
export async function findByPrevRefreshHash(db: Database, prevHash: string): Promise<ApiKeyRow | undefined> {
  const [row] = await db.select().from(mcpApiKeys).where(and(eq(mcpApiKeys.prevRefreshHash, prevHash), isNull(mcpApiKeys.revokedAt))).limit(1);
  return row;
}

/** Renueva los tokens de una conexión OAuth. `where` incluye el refresco anterior para que dos refrescos a la vez no ganen los dos. */
export async function rotateOauthTokens(
  db: Database,
  id: string,
  oldRefreshHash: string,
  values: { keyHash: string; refreshHash: string; expiresAt: Date; refreshExpiresAt: Date; at: Date },
): Promise<ApiKeyRow | undefined> {
  const [row] = await db
    .update(mcpApiKeys)
    .set({
      keyHash: values.keyHash,
      refreshHash: values.refreshHash,
      prevRefreshHash: oldRefreshHash,
      expiresAt: values.expiresAt,
      refreshExpiresAt: values.refreshExpiresAt,
      rotatedAt: values.at,
    })
    .where(and(eq(mcpApiKeys.id, id), eq(mcpApiKeys.refreshHash, oldRefreshHash), isNull(mcpApiKeys.revokedAt)))
    .returning();
  return row;
}
