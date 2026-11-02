import { getDb, type Database } from "@/server/db/client";
import { generateMagicToken } from "@/server/auth/magic-token";
import { DomainError } from "@/server/domain/errors";
import { requireSlug } from "@/server/domain/slug";
import * as repo from "@/server/repositories/clients";
import { clientInput, clientUpdateInput } from "@/server/validation/clients";
import { assertUuid, isUniqueViolation, parseInput, uniqueSlug } from "./shared";

export type { Client, ClientWithCount } from "@/server/repositories/clients";

export function listClients(db: Database = getDb()) {
  return repo.listClients(db);
}

export async function getClient(id: string, db: Database = getDb()) {
  assertUuid(id, "Cliente");
  const client = await repo.findClient(db, id);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  return client;
}

export async function createClient(raw: unknown, db: Database = getDb()) {
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

/** Invalida el link anterior y genera uno nuevo. */
export async function rotateMagicToken(id: string, db: Database = getDb()) {
  assertUuid(id, "Cliente");
  const updated = await repo.updateClient(db, id, {
    magicToken: generateMagicToken(),
    magicTokenRotatedAt: new Date(),
  });
  if (!updated) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  return updated;
}

/** Archiva (no borra): conserva el historial y el identificador sigue reservado. */
export async function archiveClient(id: string, db: Database = getDb()) {
  assertUuid(id, "Cliente");
  const updated = await repo.updateClient(db, id, { deletedAt: new Date() });
  if (!updated) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
}
