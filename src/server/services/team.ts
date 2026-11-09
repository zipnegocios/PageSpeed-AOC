import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { env } from "@/server/config/env";
import { generateMagicToken } from "@/server/auth/magic-token";
import { hashPassword } from "@/server/auth/password";
import { DomainError } from "@/server/domain/errors";
import { INVITE_TTL_MS, assertCanRemove, assertOwner, isInviteUsable, type InviteKind } from "@/server/domain/team";
import { buildInviteEmail } from "@/server/notify/invite-email";
import type { Mailer } from "@/server/notify/mailer";
import { webMailer } from "@/server/notify/web-mailer";
import * as admins from "@/server/repositories/admin-users";
import * as invites from "@/server/repositories/admin-invites";
import { MIN_PASSWORD_LENGTH, normalizeEmail, summarize, type AdminSummary } from "./admin-auth";
import { assertUuid, isUniqueViolation, parseInput } from "./shared";

export type TeamDeps = { mailer?: Mailer; appUrl?: string; now?: () => Date };

const nowOf = (deps: TeamDeps) => (deps.now ?? (() => new Date()))();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const emailInput = z.object({ email: z.string().trim().pipe(z.email("Escribe un correo válido.").max(200, "El correo es demasiado largo.")) });
const passwordInput = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, `La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`).max(200, "La contraseña es demasiado larga."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Las dos contraseñas no coinciden.", path: ["confirm"] });

export type TeamView = {
  members: Array<{ id: string; email: string; role: "owner" | "admin"; createdAt: Date; firstName: string | null; lastName: string | null }>;
  invites: Array<{ id: string; email: string; kind: InviteKind; createdAt: Date; expiresAt: Date }>;
};

/** El equipo y sus invitaciones pendientes. Solo el propietario lo ve. */
export async function listTeam(actor: AdminSummary, db: Database = getDb(), deps: TeamDeps = {}): Promise<TeamView> {
  assertOwner(actor);
  const [members, pending] = await Promise.all([admins.listAdmins(db), invites.listPending(db, nowOf(deps))]);
  return {
    members: members.map((m) => ({ id: m.id, email: m.email, role: m.role === "owner" ? "owner" : "admin", createdAt: m.createdAt, firstName: m.firstName, lastName: m.lastName })),
    invites: pending.map((i) => ({ id: i.id, email: i.email, kind: i.kind as InviteKind, createdAt: i.createdAt, expiresAt: i.expiresAt })),
  };
}

export type IssueResult = { to: string; link: string; expiresAt: Date; emailed: boolean; emailError?: string };

/** Crea el enlace (token nuevo; los anteriores del mismo correo dejan de valer) y lo envía por correo. */
async function issue(actor: AdminSummary, email: string, kind: InviteKind, db: Database, deps: TeamDeps): Promise<IssueResult> {
  const now = nowOf(deps);
  const token = generateMagicToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  await invites.revokePendingForEmail(db, email, now);
  await invites.insertInvite(db, { email, kind, tokenHash: hashToken(token), invitedBy: actor.id, expiresAt });

  const base = (deps.appUrl ?? env().APP_URL).replace(/\/+$/, "");
  const link = `${base}/invitacion/${token}`;
  const mail = buildInviteEmail({ kind, invitedBy: actor.email, link, expiresAt });
  try {
    await (deps.mailer ?? webMailer()).send({ to: email, ...mail });
    return { to: email, link, expiresAt, emailed: true };
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    const detail = `${typeof e?.code === "string" ? `${e.code}: ` : ""}${typeof e?.message === "string" ? e.message.replace(/\s+/g, " ").slice(0, 140) : "error desconocido"}`;
    return { to: email, link, expiresAt, emailed: false, emailError: detail };
  }
}

/** Invita a una persona nueva. Si ya tiene cuenta, no se invita de nuevo. */
export async function inviteMember(actor: AdminSummary, raw: unknown, db: Database = getDb(), deps: TeamDeps = {}): Promise<IssueResult> {
  assertOwner(actor);
  const email = normalizeEmail(parseInput(emailInput, raw).email);
  if (await admins.findAdminByEmail(db, email)) throw new DomainError("CONFLICT", "Esa persona ya tiene acceso al panel.");
  return issue(actor, email, "invite", db, deps);
}

/** Envía a alguien del equipo un enlace para crear una contraseña nueva (por si la olvidó). */
export async function sendPasswordReset(actor: AdminSummary, userId: string, db: Database = getDb(), deps: TeamDeps = {}): Promise<IssueResult> {
  assertOwner(actor);
  assertUuid(userId, "Usuario");
  const target = await admins.findAdminById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "Usuario no encontrado.");
  if (target.role === "owner") throw new DomainError("INVALID", "La contraseña de la cuenta propietaria no se cambia desde aquí.");
  return issue(actor, target.email, "reset", db, deps);
}

/** Reenvía una invitación pendiente con un enlace nuevo (el anterior deja de valer). */
export async function resendInvite(actor: AdminSummary, inviteId: string, db: Database = getDb(), deps: TeamDeps = {}): Promise<IssueResult> {
  assertOwner(actor);
  assertUuid(inviteId, "Invitación");
  const invite = await invites.findById(db, inviteId);
  if (!invite || !isInviteUsable(invite, nowOf(deps))) throw new DomainError("NOT_FOUND", "Esa invitación ya no está pendiente.");
  return issue(actor, invite.email, invite.kind as InviteKind, db, deps);
}

export async function revokeInvite(actor: AdminSummary, inviteId: string, db: Database = getDb(), deps: TeamDeps = {}): Promise<void> {
  assertOwner(actor);
  assertUuid(inviteId, "Invitación");
  if (!(await invites.revokeInvite(db, inviteId, nowOf(deps)))) throw new DomainError("NOT_FOUND", "Esa invitación ya no está pendiente.");
}

/** Quita a alguien del equipo. Sus sesiones dejan de valer en su siguiente petición. */
export async function removeMember(actor: AdminSummary, userId: string, db: Database = getDb(), deps: TeamDeps = {}): Promise<void> {
  assertOwner(actor);
  assertUuid(userId, "Usuario");
  const target = await admins.findAdminById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "Usuario no encontrado.");
  assertCanRemove(actor, target, await admins.countAdmins(db));
  await admins.deleteAdmin(db, target.id);
  await invites.revokePendingForEmail(db, target.email, nowOf(deps));
}

export type InvitePreview = { email: string; kind: InviteKind };

/** Qué se muestra en la página del enlace: el correo invitado. null si el enlace no sirve (el motivo no se dice). */
export async function previewInvite(token: string, db: Database = getDb(), deps: TeamDeps = {}): Promise<InvitePreview | null> {
  if (token.length < 20 || token.length > 100) return null;
  const invite = await invites.findByTokenHash(db, hashToken(token));
  if (!invite || !isInviteUsable(invite, nowOf(deps))) return null;
  return { email: invite.email, kind: invite.kind as InviteKind };
}

/** Usa el enlace: crea la cuenta (o cambia la contraseña) y devuelve la persona para abrirle sesión. */
export async function acceptInvite(token: string, raw: unknown, db: Database = getDb(), deps: TeamDeps = {}): Promise<AdminSummary> {
  const { password } = parseInput(passwordInput, raw);
  const now = nowOf(deps);
  const invalid = () => new DomainError("NOT_FOUND", "Este enlace no es válido o ya venció. Pide uno nuevo a quien te invitó.");
  if (token.length < 20 || token.length > 100) throw invalid();
  const invite = await invites.findByTokenHash(db, hashToken(token));
  if (!invite || !isInviteUsable(invite, now)) throw invalid();
  const passwordHash = await hashPassword(password);

  try {
    return await db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      if (!(await invites.markAccepted(txDb, invite.id, now))) throw invalid();
      if (invite.kind === "reset") {
        const user = await admins.findAdminByEmail(txDb, invite.email);
        if (!user) throw invalid();
        await admins.setAdminPassword(txDb, user.id, passwordHash);
        return summarize({ ...user, passwordHash });
      }
      return summarize(await admins.insertAdmin(txDb, { email: invite.email, passwordHash, role: "admin" }));
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw invalid();
    throw err;
  }
}
