import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { settings } from "@/server/db/schema";

export async function getSetting<T = unknown>(db: Database, key: string): Promise<T | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value as T | undefined;
}

export async function setSetting(db: Database, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function deleteSetting(db: Database, key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}
