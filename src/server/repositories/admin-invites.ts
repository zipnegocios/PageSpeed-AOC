import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { adminInvites } from "@/server/db/schema";

export type AdminInvite = typeof adminInvites.$inferSelect;

export async function insertInvite(
  db: Database,
  values: { email: string; kind: "invite" | "reset"; tokenHash: string; invitedBy: string; expiresAt: Date },
): Promise<AdminInvite> {
  const [row] = await db.insert(adminInvites).values(values).returning();
  if (!row) throw new Error("No se pudo crear la invitación");
  return row;
}

export async function findByTokenHash(db: Database, tokenHash: string): Promise<AdminInvite | undefined> {
  const [row] = await db.select().from(adminInvites).where(eq(adminInvites.tokenHash, tokenHash)).limit(1);
  return row;
}

/** Invitaciones sin usar, sin revocar y vigentes, las más recientes primero. */
export function listPending(db: Database, now: Date): Promise<AdminInvite[]> {
  return db
    .select()
    .from(adminInvites)
    .where(and(isNull(adminInvites.acceptedAt), isNull(adminInvites.revokedAt), gt(adminInvites.expiresAt, now)))
    .orderBy(desc(adminInvites.createdAt));
}

export async function findById(db: Database, id: string): Promise<AdminInvite | undefined> {
  const [row] = await db.select().from(adminInvites).where(eq(adminInvites.id, id)).limit(1);
  return row;
}

/** Revoca las pendientes de un correo (al emitir una nueva o al quitar a la persona). */
export async function revokePendingForEmail(db: Database, email: string, at: Date): Promise<void> {
  await db
    .update(adminInvites)
    .set({ revokedAt: at })
    .where(and(eq(adminInvites.email, email), isNull(adminInvites.acceptedAt), isNull(adminInvites.revokedAt)));
}

export async function revokeInvite(db: Database, id: string, at: Date): Promise<boolean> {
  const rows = await db
    .update(adminInvites)
    .set({ revokedAt: at })
    .where(and(eq(adminInvites.id, id), isNull(adminInvites.acceptedAt), isNull(adminInvites.revokedAt)))
    .returning({ id: adminInvites.id });
  return rows.length > 0;
}

/** Marca como usada solo si sigue pendiente: el segundo intento con el mismo enlace no encuentra nada. */
export async function markAccepted(db: Database, id: string, at: Date): Promise<boolean> {
  const rows = await db
    .update(adminInvites)
    .set({ acceptedAt: at })
    .where(and(eq(adminInvites.id, id), isNull(adminInvites.acceptedAt), isNull(adminInvites.revokedAt)))
    .returning({ id: adminInvites.id });
  return rows.length > 0;
}

export function listAll(db: Database): Promise<AdminInvite[]> {
  return db.select().from(adminInvites).orderBy(asc(adminInvites.createdAt));
}
