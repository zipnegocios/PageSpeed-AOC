import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { AttemptLimiter } from "@/server/auth/rate-limit";
import { DomainError } from "@/server/domain/errors";
import { AVATAR_PREFIX, NAME_MAX, assertAvatar, detectImage } from "@/server/domain/profile";
import * as admins from "@/server/repositories/admin-users";
import { getR2, type R2Store } from "@/server/storage/r2";
import { MIN_PASSWORD_LENGTH, summarize, type AdminSummary } from "./admin-auth";
import { parseInput } from "./shared";

export type ProfileDeps = { r2?: Pick<R2Store, "putObject" | "getObject" | "deleteObjects"> };

// Un singleton por proceso: 5 contraseñas actuales incorrectas cada 15 minutos por administrador.
const g = globalThis as unknown as { __pagespeedPasswordLimiter?: AttemptLimiter };
const passwordLimiter = (g.__pagespeedPasswordLimiter ??= new AttemptLimiter({ max: 5, windowMs: 15 * 60_000 }));

export const profileName = z
  .string()
  .max(NAME_MAX, `Hasta ${NAME_MAX} caracteres.`)
  .refine((v) => !/[\r\n]/.test(v), "Sin saltos de línea.")
  .transform((v) => v.trim());

const profileInput = z.object({ firstName: profileName, lastName: profileName });

/** Guarda nombre y apellido (ambos opcionales). */
export async function updateProfile(admin: AdminSummary, raw: unknown, db: Database = getDb()): Promise<AdminSummary> {
  const input = parseInput(profileInput, raw);
  const row = await admins.updateProfile(db, admin.id, { firstName: input.firstName || null, lastName: input.lastName || null });
  if (!row) throw new DomainError("NOT_FOUND", "Usuario no encontrado.");
  return summarize(row);
}

const passwordInput = z
  .object({
    current: z.string().min(1, "Escribe tu contraseña actual.").max(200),
    password: z.string().min(MIN_PASSWORD_LENGTH, `La contraseña nueva necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`).max(200, "La contraseña es demasiado larga."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Las dos contraseñas nuevas no coinciden.", path: ["confirm"] });

/**
 * Cambia la contraseña de quien la pide. Devuelve el resumen nuevo: la versión de la contraseña cambia, así que las demás
 * sesiones dejan de valer, y quien llama renueva la suya con este resumen para seguir dentro.
 */
export async function changePassword(admin: AdminSummary, raw: unknown, db: Database = getDb()): Promise<AdminSummary> {
  if (passwordLimiter.isBlocked(admin.id)) throw new DomainError("CONFLICT", "Demasiados intentos con la contraseña actual. Espera unos minutos.");
  const input = parseInput(passwordInput, raw);
  const row = await admins.findAdminById(db, admin.id);
  if (!row) throw new DomainError("NOT_FOUND", "Usuario no encontrado.");
  if (!(await verifyPassword(input.current, row.passwordHash))) {
    passwordLimiter.recordFailure(admin.id);
    throw new DomainError("INVALID", "La contraseña actual no es correcta.");
  }
  if (input.password === input.current) throw new DomainError("INVALID", "La contraseña nueva tiene que ser distinta de la actual.");
  passwordLimiter.reset(admin.id);
  const passwordHash = await hashPassword(input.password);
  await admins.setAdminPassword(db, admin.id, passwordHash);
  return summarize({ ...row, passwordHash, provisionalPassword: false });
}

/** Valida la foto y la guarda en R2 bajo `_avatars/<userId>/`. Devuelve la clave del objeto. No toca la base. */
export async function putAvatarObject(userId: string, bytes: Uint8Array, deps: ProfileDeps = {}): Promise<string> {
  const kind = assertAvatar(bytes);
  const key = `${AVATAR_PREFIX}${userId}/${randomBytes(12).toString("hex")}.${kind.ext}`;
  await (deps.r2 ?? getR2()).putObject(key, Buffer.from(bytes), kind.mime);
  return key;
}

/** Borra objetos de fotos en R2 (sin fallar: una foto huérfana no debe romper lo demás). */
export async function deleteAvatarObjects(keys: string[], deps: ProfileDeps = {}): Promise<void> {
  const list = keys.filter(Boolean);
  if (list.length > 0) await (deps.r2 ?? getR2()).deleteObjects(list).catch(() => undefined);
}

/** Guarda la foto (ya validada por firma y tamaño) en R2 y borra la anterior. */
export async function setAvatar(admin: AdminSummary, bytes: Uint8Array, db: Database = getDb(), deps: ProfileDeps = {}): Promise<string> {
  const key = await putAvatarObject(admin.id, bytes, deps);
  const previous = (await admins.findAdminById(db, admin.id))?.avatarKey;
  await admins.setAvatarKey(db, admin.id, key);
  if (previous && previous !== key) await deleteAvatarObjects([previous], deps);
  return key;
}

export async function removeAvatar(admin: AdminSummary, db: Database = getDb(), deps: ProfileDeps = {}): Promise<void> {
  const previous = (await admins.findAdminById(db, admin.id))?.avatarKey;
  await admins.setAvatarKey(db, admin.id, null);
  if (previous) await (deps.r2 ?? getR2()).deleteObjects([previous]).catch(() => undefined);
}

/** La foto de un administrador, o null si no tiene. */
export async function readAvatar(adminId: string, db: Database = getDb(), deps: ProfileDeps = {}): Promise<{ bytes: Buffer; contentType: string } | null> {
  const row = await admins.findAdminById(db, adminId);
  if (!row?.avatarKey) return null;
  const bytes = await (deps.r2 ?? getR2()).getObject(row.avatarKey);
  const kind = detectImage(bytes);
  return kind ? { bytes, contentType: kind.mime } : null;
}
