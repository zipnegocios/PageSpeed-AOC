import { getDb, type Database } from "@/server/db/client";
import { DEFAULT_SENDER, senderFromAdmin, type ClientSender } from "@/server/domain/client-sender";
import { DomainError } from "@/server/domain/errors";
import { displayName } from "@/server/domain/profile";
import * as admins from "@/server/repositories/admin-users";
import * as repo from "@/server/repositories/clients";
import type { Client } from "@/server/repositories/clients";
import { assertUuid } from "./shared";

/**
 * Quién firma los correos de un cliente: su responsable. Sin responsable (clientes anteriores a esta función, o una cuenta
 * que ya no existe) firma la cuenta propietaria; sin ninguna cuenta, la firma por defecto.
 */
export async function resolveSender(db: Database, client: Pick<Client, "ownerId">): Promise<ClientSender> {
  const owner = client.ownerId ? await admins.findAdminById(db, client.ownerId) : undefined;
  const admin = owner ?? (await admins.findOwnerAccount(db)) ?? (await admins.findFirstAdmin(db));
  return admin ? senderFromAdmin(admin) : DEFAULT_SENDER;
}

export type ResponsibleOption = { id: string; name: string; email: string; role: "owner" | "admin"; phone: string | null; hasName: boolean };

/** Las personas del equipo a las que se puede asignar un cliente. */
export async function listResponsibles(db: Database = getDb()): Promise<ResponsibleOption[]> {
  const list = await admins.listAdmins(db);
  return list.map((a) => ({
    id: a.id,
    name: displayName(a),
    email: a.email,
    role: a.role === "owner" ? "owner" : "admin",
    phone: a.phone,
    hasName: Boolean([a.firstName, a.lastName].some((x) => x?.trim())),
  }));
}

/** Cambia el responsable de un cliente: desde ahí firma sus correos y recibe sus alertas. */
export async function assignClientOwner(clientId: string, adminId: string, db: Database = getDb()): Promise<void> {
  assertUuid(clientId, "Cliente");
  assertUuid(adminId, "Responsable");
  const [client, admin] = await Promise.all([repo.findClient(db, clientId), admins.findAdminById(db, adminId)]);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  if (!admin) throw new DomainError("NOT_FOUND", "Esa persona ya no está en el equipo.");
  await repo.setClientOwner(db, clientId, adminId);
}
