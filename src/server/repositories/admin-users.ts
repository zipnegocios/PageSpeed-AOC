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

/** Cuántas cuentas propietarias hay (debe ser una). */
export async function countOwners(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(adminUsers).where(eq(adminUsers.role, "owner"));
  return row?.n ?? 0;
}

export async function insertAdmin(
  db: Database,
  values: { email: string; passwordHash: string; role?: "owner" | "admin" },
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

/** Todo el equipo, de la cuenta más antigua a la más reciente. */
export function listAdmins(db: Database): Promise<AdminUser[]> {
  return db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
}

export async function deleteAdmin(db: Database, id: string): Promise<boolean> {
  const rows = await db.delete(adminUsers).where(eq(adminUsers.id, id)).returning({ id: adminUsers.id });
  return rows.length > 0;
}

/** Cambia la contraseña (y con ella la versión de las sesiones: las anteriores dejan de valer). */
export async function setAdminPassword(db: Database, id: string, passwordHash: string): Promise<boolean> {
  const rows = await db.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, id)).returning({ id: adminUsers.id });
  return rows.length > 0;
}

export async function updateProfile(db: Database, id: string, values: { firstName: string | null; lastName: string | null }): Promise<AdminUser | undefined> {
  const [row] = await db.update(adminUsers).set(values).where(eq(adminUsers.id, id)).returning();
  return row;
}

/** Guarda la clave de la foto en R2 (null la quita). */
export async function setAvatarKey(db: Database, id: string, avatarKey: string | null): Promise<void> {
  await db.update(adminUsers).set({ avatarKey }).where(eq(adminUsers.id, id));
}
