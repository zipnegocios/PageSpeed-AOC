import { asc, count, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { adminUsers } from "@/server/db/schema";

export type AdminUser = typeof adminUsers.$inferSelect;

export async function findAdminByEmail(db: Database, email: string): Promise<AdminUser | undefined> {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  return row;
}

export async function findAdminById(db: Database, id: string): Promise<AdminUser | undefined> {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  return row;
}

export async function countAdmins(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(adminUsers);
  return row?.n ?? 0;
}

export async function insertAdmin(
  db: Database,
  values: { email: string; passwordHash: string },
): Promise<AdminUser> {
  const [row] = await db.insert(adminUsers).values(values).returning();
  if (!row) throw new Error("No se pudo crear el administrador");
  return row;
}

/** El administrador más antiguo: destinatario de las alertas si no hay ALERT_EMAIL. */
export async function findFirstAdmin(db: Database): Promise<AdminUser | undefined> {
  const [row] = await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt)).limit(1);
  return row;
}
