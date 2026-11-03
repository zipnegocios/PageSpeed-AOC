import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { clients, projects } from "@/server/db/schema";

export type Client = typeof clients.$inferSelect;
export type ClientWithCount = Client & { projectCount: number };

export async function listClients(db: Database): Promise<ClientWithCount[]> {
  const rows = await db
    .select({
      client: clients,
      projectCount: count(projects.id),
    })
    .from(clients)
    .leftJoin(projects, and(eq(projects.clientId, clients.id), isNull(projects.deletedAt)))
    .where(isNull(clients.deletedAt))
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
