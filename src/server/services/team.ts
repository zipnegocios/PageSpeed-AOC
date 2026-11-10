import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { env } from "@/server/config/env";
import { generateMagicToken } from "@/server/auth/magic-token";
import { hashPassword } from "@/server/auth/password";
import { assertAvatar } from "@/server/domain/profile";
import { DomainError } from "@/server/domain/errors";
import { INVITE_TTL_MS, assertCanRemove, assertOwner, isInviteUsable, type InviteKind } from "@/server/domain/team";
import { buildInviteEmail } from "@/server/notify/invite-email";
import type { Mailer } from "@/server/notify/mailer";
import { webMailer } from "@/server/notify/web-mailer";
import * as admins from "@/server/repositories/admin-users";
import * as invites from "@/server/repositories/admin-invites";
import * as shares from "@/server/repositories/team-shares";
import { MIN_PASSWORD_LENGTH, normalizeEmail, summarize, type AdminSummary } from "./admin-auth";
import { deleteAvatarObjects, profileName, putAvatarObject, type ProfileDeps } from "./profile";
import { assertUuid, isUniqueViolation, parseInput } from "./shared";

export type TeamDeps = { mailer?: Mailer; appUrl?: string; now?: () => Date } & ProfileDeps;

const nowOf = (deps: TeamDeps) => (deps.now ?? (() => new Date()))();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const emailField = z.string().trim().pipe(z.email("Escribe un correo válido.").max(200, "El correo es demasiado largo."));

const inviteInput = z
  .object({
    email: emailField,
    firstName: profileName.default(""),
    lastName: profileName.default(""),
    // «email»: enlace de un solo uso por correo; «password»: la cuenta se crea ahora con una contraseña provisional.
    access: z.enum(["email", "password"]).default("email"),
    password: z.string().max(200, "La contraseña es demasiado larga.").optional(),
  })
  .refine((v) => v.access !== "password" || (v.password ?? "").length >= MIN_PASSWORD_LENGTH, {
    message: `La contraseña provisional necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    path: ["password"],
  });

const passwordInput = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, `La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`).max(200, "La contraseña es demasiado larga."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Las dos contraseñas no coinciden.", path: ["confirm"] });

export type TeamView = {
  members: Array<{
    id: string;
    email: string;
    role: "owner" | "admin";
    createdAt: Date;
    firstName: string | null;
    lastName: string | null;
    avatarKey: string | null;
    provisionalPassword: boolean;
    /** Lo que ve: clientes a su cargo, clientes que le compartieron enteros y proyectos sueltos. El propietario ve todo. */
    access: { owned: number; sharedClients: number; sharedProjects: number };
  }>;
  invites: Array<{ id: string; email: string; kind: InviteKind; createdAt: Date; expiresAt: Date; firstName: string | null; lastName: string | null }>;
};

/** El equipo y sus invitaciones pendientes. Solo el propietario lo ve. */
export async function listTeam(actor: AdminSummary, db: Database = getDb(), deps: TeamDeps = {}): Promise<TeamView> {
  assertOwner(actor);
  const [members, pending, shared, owned] = await Promise.all([admins.listAdmins(db), invites.listPending(db, nowOf(deps)), shares.countSharesByAdmin(db), shares.countOwnedClientsByAdmin(db)]);
  const sharedBy = new Map(shared.map((r) => [r.adminId, r]));
  const ownedBy = new Map(owned.map((r) => [r.adminId, r.clients]));
  return {
    members: members.map((m) => ({ access: { owned: ownedBy.get(m.id) ?? 0, sharedClients: sharedBy.get(m.id)?.clients ?? 0, sharedProjects: sharedBy.get(m.id)?.projects ?? 0 }, id: m.id, email: m.email, role: m.role === "owner" ? "owner" : "admin", createdAt: m.createdAt, firstName: m.firstName, lastName: m.lastName, avatarKey: m.avatarKey, provisionalPassword: m.provisionalPassword })),
    invites: pending.map((i) => ({ id: i.id, email: i.email, kind: i.kind as InviteKind, createdAt: i.createdAt, expiresAt: i.expiresAt, firstName: i.firstName, lastName: i.lastName })),
  };
}

export type IssueResult = { to: string; link: string; expiresAt: Date; emailed: boolean; emailError?: string };

/** Crea el enlace (token nuevo; los anteriores del mismo correo dejan de valer) y lo envía por correo. */
type InviteProfile = { userId: string | null; firstName: string | null; lastName: string | null; avatarKey: string | null };
const NO_PROFILE: InviteProfile = { userId: null, firstName: null, lastName: null, avatarKey: null };

async function issue(actor: AdminSummary, email: string, kind: InviteKind, db: Database, deps: TeamDeps, profile: InviteProfile = NO_PROFILE): Promise<IssueResult> {
  const now = nowOf(deps);
  const token = generateMagicToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  // Lo pendiente de ese correo se reemplaza: sus fotos ya no sirven (salvo la que se reutiliza al reenviar).
  const replaced = await invites.listPendingForEmail(db, email, now);
  await invites.revokePendingForEmail(db, email, now);
  await invites.insertInvite(db, { email, kind, tokenHash: hashToken(token), invitedBy: actor.id, expiresAt, ...profile });
  await deleteAvatarObjects(replaced.map((r) => r.avatarKey ?? "").filter((k) => k && k !== profile.avatarKey), deps);

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

export type InviteOutcome = ({ mode: "email" } & IssueResult) | { mode: "password"; to: string; password: string; loginUrl: string };

/**
 * Da de alta a una persona nueva con su perfil completo (nombre, apellido y foto, todo opcional). Dos formas de entrar:
 * un enlace de un solo uso por correo, o una cuenta que se crea ahora con una contraseña provisional que la persona puede
 * cambiar después. Si ya tiene cuenta, no se vuelve a invitar.
 */
export async function inviteMember(actor: AdminSummary, raw: unknown, db: Database = getDb(), deps: TeamDeps = {}, avatar?: Uint8Array | null): Promise<InviteOutcome> {
  assertOwner(actor);
  const input = parseInput(inviteInput, raw);
  const email = normalizeEmail(input.email);
  if (await admins.findAdminByEmail(db, email)) throw new DomainError("CONFLICT", "Esa persona ya tiene acceso al panel.");
  const hasAvatar = Boolean(avatar && avatar.length > 0);
  if (hasAvatar) assertAvatar(avatar!); // se rechaza antes de crear nada

  const userId = randomUUID();
  const firstName = input.firstName || null;
  const lastName = input.lastName || null;
  const avatarKey = hasAvatar ? await putAvatarObject(userId, avatar!, deps) : null;
  try {
    if (input.access === "password") {
      const now = nowOf(deps);
      const replaced = await invites.listPendingForEmail(db, email, now);
      await invites.revokePendingForEmail(db, email, now);
      await deleteAvatarObjects(replaced.map((r) => r.avatarKey ?? ""), deps);
      await admins.insertAdmin(db, {
        id: userId,
        email,
        passwordHash: await hashPassword(input.password!),
        role: "admin",
        firstName,
        lastName,
        avatarKey,
        provisionalPassword: true,
      });
      const base = (deps.appUrl ?? env().APP_URL).replace(/\/+$/, "");
      return { mode: "password", to: email, password: input.password!, loginUrl: `${base}/login` };
    }
    return { mode: "email", ...(await issue(actor, email, "invite", db, deps, { userId, firstName, lastName, avatarKey })) };
  } catch (err) {
    await deleteAvatarObjects(avatarKey ? [avatarKey] : [], deps);
    if (isUniqueViolation(err)) throw new DomainError("CONFLICT", "Esa persona ya tiene acceso al panel.");
    throw err;
  }
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
  return issue(actor, invite.email, invite.kind as InviteKind, db, deps, { userId: invite.userId, firstName: invite.firstName, lastName: invite.lastName, avatarKey: invite.avatarKey });
}

export async function revokeInvite(actor: AdminSummary, inviteId: string, db: Database = getDb(), deps: TeamDeps = {}): Promise<void> {
  assertOwner(actor);
  assertUuid(inviteId, "Invitación");
  const invite = await invites.findById(db, inviteId);
  if (!(await invites.revokeInvite(db, inviteId, nowOf(deps)))) throw new DomainError("NOT_FOUND", "Esa invitación ya no está pendiente.");
  await deleteAvatarObjects(invite?.avatarKey ? [invite.avatarKey] : [], deps);
}

/** Quita a alguien del equipo. Sus sesiones dejan de valer en su siguiente petición. */
export async function removeMember(actor: AdminSummary, userId: string, db: Database = getDb(), deps: TeamDeps = {}): Promise<void> {
  assertOwner(actor);
  assertUuid(userId, "Usuario");
  const target = await admins.findAdminById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "Usuario no encontrado.");
  assertCanRemove(actor, target, await admins.countAdmins(db));
  // Sus clientes pasan al propietario (si no, quedarían sin responsable ni a la vista de nadie) y sus claves de agente dejan de existir.
  // Sus compartidos caen solos por la clave foránea.
  await db.transaction(async (tx) => {
    await shares.reassignClients(tx as unknown as Database, target.id, actor.id);
    await shares.deleteKeysCreatedBy(tx as unknown as Database, target.id);
    await admins.deleteAdmin(tx as unknown as Database, target.id);
  });
  await invites.revokePendingForEmail(db, target.email, nowOf(deps));
  await deleteAvatarObjects(target.avatarKey ? [target.avatarKey] : [], deps);
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
        return summarize({ ...user, passwordHash, provisionalPassword: false });
      }
      return summarize(
        await admins.insertAdmin(txDb, {
          ...(invite.userId ? { id: invite.userId } : {}),
          email: invite.email,
          passwordHash,
          role: "admin",
          firstName: invite.firstName,
          lastName: invite.lastName,
          avatarKey: invite.avatarKey,
        }),
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw invalid();
    throw err;
  }
}
