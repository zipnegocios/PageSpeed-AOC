import type { Scope } from "@/server/domain/access";
import { getDb, type Database } from "@/server/db/client";
import { generateMagicToken } from "@/server/auth/magic-token";
import { DomainError } from "@/server/domain/errors";
import { requireSlug } from "@/server/domain/slug";
import * as repo from "@/server/repositories/clients";
import { clientInput, clientUpdateInput } from "@/server/validation/clients";
import { assertUuid, isUniqueViolation, isUuid, parseInput, uniqueSlug } from "./shared";

export type { Client, ClientWithCount } from "@/server/repositories/clients";

/** Los clientes vigentes; con `scope`, solo los que la persona ve (ver `domain/access.ts`). */
export function listClients(db: Database = getDb(), scope?: Scope) {
  return repo.listClients(db, scope);
}

export async function getClient(id: string, db: Database = getDb()) {
  assertUuid(id, "Cliente");
  const client = await repo.findClient(db, id);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  return client;
}

/** Cliente por identificador legible (slug) o, para enlaces antiguos, por UUID. */
export async function getClientByRef(ref: string, db: Database = getDb()) {
  const client = isUuid(ref) ? await repo.findClient(db, ref) : await repo.findClientBySlug(db, ref);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  return client;
}

/** `opts.ownerId`: quien lo crea queda como su responsable (firma sus correos, recibe sus alertas). */
export async function createClient(raw: unknown, db: Database = getDb(), opts: { ownerId?: string | null } = {}) {
  const input = parseInput(clientInput, raw);
  const slug = input.slug
    ? requireSlug(input.slug)
    : await uniqueSlug(input.name, (s) => repo.slugTaken(db, s));
  if (input.slug && (await repo.slugTaken(db, slug))) {
    throw new DomainError("CONFLICT", `Ya existe un cliente con el identificador "${slug}".`);
  }
  try {
    return await repo.insertClient(db, {
      name: input.name,
      slug,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail?.toLowerCase() ?? null,
      contactPhone: input.contactPhone ?? null,
      notes: input.notes ?? null,
      magicToken: generateMagicToken(),
      ownerId: opts.ownerId ?? null,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("CONFLICT", `Ya existe un cliente con el identificador "${slug}".`);
    throw err;
  }
}

/** El identificador (slug) y el link mágico no se editan por aquí. */
export async function updateClient(id: string, raw: unknown, db: Database = getDb()) {
  assertUuid(id, "Cliente");
  const input = parseInput(clientUpdateInput, raw);
  const updated = await repo.updateClient(db, id, {
    name: input.name,
    contactName: input.contactName ?? null,
    contactEmail: input.contactEmail?.toLowerCase() ?? null,
    contactPhone: input.contactPhone ?? null,
    notes: input.notes ?? null,
  });
  if (!updated) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  return updated;
}

/** Activo/Suspendido: control manual de acceso al portal por contrato. */
export async function setClientStatus(id: string, status: "active" | "suspended", db: Database = getDb()) {
  assertUuid(id, "Cliente");
  if (status !== "active" && status !== "suspended") throw new DomainError("INVALID", "Estado no válido.");
  const updated = await repo.updateClient(db, id, { status });
  if (!updated) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  return updated;
}

/**
 * Cambia el identificador (slug). El anterior sigue funcionando en los enlaces viejos y queda reservado. Los informes ya
 * guardados no se mueven: cada auditoría guarda la clave completa de su archivo en R2.
 */
export async function renameClientSlug(id: string, rawSlug: string, db: Database = getDb()) {
  assertUuid(id, "Cliente");
  const slug = requireSlug((rawSlug ?? "").trim());
  const current = await repo.findClient(db, id);
  if (!current) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  if (slug === current.slug) return current;
  // Volver a un identificador anterior del mismo cliente está permitido.
  if (!current.slugAliases.includes(slug) && (await repo.slugTaken(db, slug))) {
    throw new DomainError("CONFLICT", `El identificador "${slug}" ya está en uso (o fue de otro cliente).`);
  }
  try {
    const updated = await repo.setClientSlug(db, id, slug, current.slug);
    if (!updated) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("CONFLICT", `El identificador "${slug}" ya está en uso.`);
    throw err;
  }
}

/** Archiva (no borra): conserva el historial y el identificador sigue reservado. */
export async function archiveClient(id: string, db: Database = getDb()) {
  assertUuid(id, "Cliente");
  const updated = await repo.updateClient(db, id, { deletedAt: new Date() });
  if (!updated) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
}
