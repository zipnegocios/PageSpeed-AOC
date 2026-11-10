import { getDb, type Database } from "@/server/db/client";
import { canManage, type Actor } from "@/server/domain/access";
import { DomainError } from "@/server/domain/errors";
import * as admins from "@/server/repositories/admin-users";
import * as shares from "@/server/repositories/team-shares";
import { assertManageClient, assertManageProject } from "./access";
import { assertUuid } from "./shared";

/**
 * Compartir clientes y proyectos con otras personas del equipo. Solo lo hace el propietario o el responsable del cliente; el destino
 * debe ser un miembro (no el propietario, que ya lo ve todo, ni el responsable, que ya lo tiene).
 */

async function assertTarget(db: Database, clientOwnerId: string | null, memberId: string) {
  assertUuid(memberId, "Persona");
  const member = await admins.findAdminById(db, memberId);
  if (!member) throw new DomainError("NOT_FOUND", "Persona no encontrada.");
  if (member.role === "owner") throw new DomainError("INVALID", "La cuenta propietaria ya ve todo.");
  if (clientOwnerId === member.id) throw new DomainError("INVALID", "Esa persona ya es la responsable de este cliente.");
  return member;
}

/** Comparte (o deja de compartir) el cliente entero, con todos sus proyectos actuales y futuros. */
export async function setClientShare(actor: Actor, clientId: string, memberId: string, enabled: boolean, db: Database = getDb()): Promise<void> {
  const client = await assertManageClient(db, actor, clientId);
  await assertTarget(db, client.ownerId, memberId);
  if (enabled) await shares.insertShare(db, { adminId: memberId, clientId, projectId: null, grantedBy: actor.id });
  else await shares.deleteClientShare(db, memberId, clientId);
}

/** Comparte (o deja de compartir) un proyecto suelto: la persona ve el cliente solo como contenedor de ese proyecto. */
export async function setProjectShare(actor: Actor, projectId: string, memberId: string, enabled: boolean, db: Database = getDb()): Promise<void> {
  const project = await assertManageProject(db, actor, projectId);
  const client = await assertManageClient(db, actor, project.clientId);
  await assertTarget(db, client.ownerId, memberId);
  if (enabled) await shares.insertShare(db, { adminId: memberId, clientId: project.clientId, projectId, grantedBy: actor.id });
  else await shares.deleteProjectShare(db, memberId, projectId);
}

export type ShareMember = { id: string; email: string; name: string; role: "owner" | "admin" };
export type ClientSharing = {
  /** Las personas con las que se puede compartir (el equipo, sin el propietario ni el responsable). */
  candidates: ShareMember[];
  /** Ids de las personas con acceso al cliente entero por un compartido. */
  clientShared: string[];
  /** Por proyecto: ids de las personas con ese proyecto compartido suelto. */
  projectShared: Record<string, string[]>;
};

const display = (m: { email: string; firstName: string | null; lastName: string | null }) => [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || m.email;

/** Lo que muestra la tarjeta «Compartir»: con quién se puede compartir y con quién ya está. Solo para quien puede gestionar el cliente. */
export async function getClientSharing(actor: Actor, clientId: string, db: Database = getDb()): Promise<ClientSharing | null> {
  assertUuid(clientId, "Cliente");
  let client;
  try {
    client = await assertManageClient(db, actor, clientId);
  } catch {
    return null;
  }
  if (!canManage(actor, client)) return null;
  const [team, rows] = await Promise.all([admins.listAdmins(db), shares.listSharesForClient(db, clientId)]);
  const projectShared: Record<string, string[]> = {};
  for (const r of rows) if (r.projectId) (projectShared[r.projectId] ??= []).push(r.adminId);
  return {
    candidates: team.filter((m) => m.role !== "owner" && m.id !== client.ownerId).map((m) => ({ id: m.id, email: m.email, name: display(m), role: m.role as "owner" | "admin" })),
    clientShared: rows.filter((r) => r.projectId === null).map((r) => r.adminId),
    projectShared,
  };
}
