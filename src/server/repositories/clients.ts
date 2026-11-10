import type { Scope } from "@/server/domain/access";
import { scopeWhere } from "./scope";
import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { clients, projects } from "@/server/db/schema";

/** Un cliente es visible si está en la lista de clientes del alcance o si tiene al menos un proyecto visible (el join de proyectos ya viene filtrado). */
function visibleClients(scope: Scope | undefined): SQL | undefined {
  if (!scope || scope.all) return undefined;
  return scope.clientIds.length > 0 ? or(inArray(clients.id, scope.clientIds), isNotNull(projects.id)) : isNotNull(projects.id);
}

export type Client = typeof clients.$inferSelect;
export type ClientWithCount = Client & { projectCount: number };

/**
 * Los clientes vigentes con su número de proyectos. Con `scope`, los que la persona ve: los suyos y los compartidos enteros, y los que
 * solo tienen algún proyecto compartido (de ellos, el recuento cuenta solo los proyectos que ve).
 */
export async function listClients(db: Database, scope?: Scope): Promise<ClientWithCount[]> {
  const rows = await db
    .select({
      client: clients,
      projectCount: count(projects.id),
    })
    .from(clients)
    .leftJoin(projects, and(eq(projects.clientId, clients.id), isNull(projects.deletedAt), scopeWhere(scope, projects.id, projects.clientId)))
    .where(and(isNull(clients.deletedAt), visibleClients(scope)))
    .groupBy(clients.id)
    .orderBy(asc(sql`lower(${clients.name})`));
  return rows.map((r) => ({ ...r.client, projectCount: r.projectCount }));
}

export async function findClient(db: Database, id: string): Promise<Client | undefined> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
    .limit(1);
  return row;
}

/** Por identificador actual o por uno anterior (enlaces viejos). Solo clientes vigentes. */
/** El cliente tenga o no archivado (para decidir quién puede restaurar o borrar). */
export async function findClientIncludingArchived(db: Database, id: string): Promise<Client | undefined> {
  const [row] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  return row;
}

export async function findClientBySlug(db: Database, slug: string): Promise<Client | undefined> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(or(eq(clients.slug, slug), sql`${slug} = any(${clients.slugAliases})`), isNull(clients.deletedAt)))
    .limit(1);
  return row;
}

/** Incluye clientes archivados e identificadores anteriores: siguen reservados (enlaces viejos y carpetas de R2). */
export async function slugTaken(db: Database, slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(or(eq(clients.slug, slug), sql`${slug} = any(${clients.slugAliases})`))
    .limit(1);
  return Boolean(row);
}

/** Guarda la huella de un PIN nuevo y sube la versión (cierra las sesiones abiertas). */
export async function setClientPinRow(db: Database, id: string, pinHash: string, now: Date, pinEnc: Buffer | null = null): Promise<Client | undefined> {
  const [row] = await db
    .update(clients)
    .set({ pinHash, pinEnc, pinVersion: sql`${clients.pinVersion} + 1`, pinUpdatedAt: now })
    .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
    .returning();
  return row;
}

/**
 * Reserva el envío de un PIN por correo: solo prospera si el último fue hace más de `cooldownMs`. Devuelve el valor
 * anterior para poder devolverlo si el correo falla; null si el cliente no existe o aún está en espera.
 */
export async function reservePinRequest(db: Database, id: string, now: Date, cooldownMs: number): Promise<{ previous: Date | null } | null> {
  const cutoff = new Date(now.getTime() - cooldownMs);
  const [before] = await db.select({ at: clients.pinRequestedAt }).from(clients).where(and(eq(clients.id, id), isNull(clients.deletedAt))).limit(1);
  if (!before) return null;
  const rows = await db
    .update(clients)
    .set({ pinRequestedAt: now })
    .where(and(eq(clients.id, id), isNull(clients.deletedAt), or(isNull(clients.pinRequestedAt), sql`${clients.pinRequestedAt} < ${cutoff}`)))
    .returning({ id: clients.id });
  return rows.length > 0 ? { previous: before.at } : null;
}

export async function restorePinRequest(db: Database, id: string, previous: Date | null): Promise<void> {
  await db.update(clients).set({ pinRequestedAt: previous }).where(eq(clients.id, id));
}

/** Cambia el identificador y guarda el anterior como alias. Si se vuelve a uno anterior propio, deja de ser alias. */
export async function setClientSlug(db: Database, id: string, slug: string, previous: string): Promise<Client | undefined> {
  const [row] = await db
    .update(clients)
    .set({ slug, slugAliases: sql`array_append(array_remove(${clients.slugAliases}, ${slug}), ${previous})` })
    .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
    .returning();
  return row;
}

export async function insertClient(db: Database, values: typeof clients.$inferInsert): Promise<Client> {
  const [row] = await db.insert(clients).values(values).returning();
  if (!row) throw new Error("No se pudo crear el cliente");
  return row;
}

export async function updateClient(
  db: Database,
  id: string,
  values: Partial<typeof clients.$inferInsert>,
): Promise<Client | undefined> {
  const [row] = await db
    .update(clients)
    .set(values)
    .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
    .returning();
  return row;
}

/** Cliente por link mágico (solo activos o suspendidos, nunca archivados). */
export async function findClientByToken(db: Database, token: string): Promise<Client | undefined> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.magicToken, token), isNull(clients.deletedAt)))
    .limit(1);
  return row;
}

const LOGO_COLUMN = { icon: "logoIconKey", full: "logoFullKey" } as const;

/** Guarda (o quita, con null) la clave del logotipo de un tipo. Devuelve la clave anterior para borrar su objeto. */
export async function setClientLogoKey(db: Database, id: string, kind: "icon" | "full", key: string | null): Promise<{ previous: string | null } | undefined> {
  const column = LOGO_COLUMN[kind];
  const [before] = await db.select({ key: clients[column] }).from(clients).where(and(eq(clients.id, id), isNull(clients.deletedAt))).limit(1);
  if (!before) return undefined;
  await db.update(clients).set({ [column]: key, logoUpdatedAt: new Date() }).where(eq(clients.id, id));
  return { previous: before.key };
}

export async function setClientLogoBg(db: Database, id: string, bg: string | null): Promise<boolean> {
  const rows = await db.update(clients).set({ logoBg: bg, logoUpdatedAt: new Date() }).where(and(eq(clients.id, id), isNull(clients.deletedAt))).returning({ id: clients.id });
  return rows.length > 0;
}

/** Cambia el responsable del cliente. */
export async function setClientOwner(db: Database, id: string, ownerId: string | null): Promise<boolean> {
  const rows = await db.update(clients).set({ ownerId }).where(and(eq(clients.id, id), isNull(clients.deletedAt))).returning({ id: clients.id });
  return rows.length > 0;
}

/** Guarda las personas que reciben los correos en copia. */
export async function setClientCc(db: Database, id: string, ccContacts: Array<{ name: string; email: string }>): Promise<void> {
  await db.update(clients).set({ ccContacts }).where(and(eq(clients.id, id), isNull(clients.deletedAt)));
}

/** Anota cuándo se envió la última bienvenida. */
export async function setWelcomeSent(db: Database, id: string, at: Date): Promise<void> {
  await db.update(clients).set({ welcomeSentAt: at }).where(and(eq(clients.id, id), isNull(clients.deletedAt)));
}
