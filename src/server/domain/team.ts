import { DomainError } from "./errors";

export type MemberRole = "owner" | "admin";
export type InviteKind = "invite" | "reset";

/** Vigencia de una invitación o enlace de contraseña nueva. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteState = { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null };

/** Una invitación sirve si no se usó, no se revocó y no venció. */
export function isInviteUsable(invite: InviteState, now: Date): boolean {
  return invite.acceptedAt === null && invite.revokedAt === null && invite.expiresAt.getTime() > now.getTime();
}

/** Solo el propietario gestiona el equipo. */
export function assertOwner(actor: { role: string }): void {
  if (actor.role !== "owner") throw new DomainError("NOT_FOUND", "Página no encontrada.");
}

/** Reglas para quitar a alguien del equipo: nunca al propietario ni a uno mismo; siempre queda un administrador. */
export function assertCanRemove(actor: { id: string }, target: { id: string; role: string }, adminCount: number): void {
  if (target.role === "owner") throw new DomainError("INVALID", "No se puede quitar a la cuenta propietaria.");
  if (target.id === actor.id) throw new DomainError("INVALID", "No puedes quitarte a ti mismo.");
  if (adminCount <= 1) throw new DomainError("INVALID", "Tiene que quedar al menos un administrador.");
}
