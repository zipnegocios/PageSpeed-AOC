import { getDb, type Database } from "@/server/db/client";
import { getDummyHash, hashPassword, verifyPassword } from "@/server/auth/password";
import { passwordVersion, type SessionClaims } from "@/server/auth/session-token";
import {
  countOwners,
  findAdminByEmail,
  findAdminById,
  insertAdmin,
  type AdminUser,
} from "@/server/repositories/admin-users";

export const MIN_PASSWORD_LENGTH = 12;

export type AdminSummary = {
  id: string;
  email: string;
  pv: string;
  role: "owner" | "admin";
  firstName: string | null;
  lastName: string | null;
  /** Clave de la foto en R2 (null si no hay); solo sirve para saber si hay foto y para cambiar la URL al cambiarla. */
  avatarKey: string | null;
  /** La contraseña la puso el propietario al crear la cuenta y la persona aún no la cambió. */
  provisionalPassword: boolean;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function summarize(admin: AdminUser): AdminSummary {
  return {
    id: admin.id,
    email: admin.email,
    pv: passwordVersion(admin.passwordHash),
    role: admin.role === "owner" ? "owner" : "admin",
    firstName: admin.firstName,
    lastName: admin.lastName,
    avatarKey: admin.avatarKey,
    provisionalPassword: admin.provisionalPassword,
  };
}

export type SeedResult = "created" | "exists" | "missing-env" | "invalid";

/**
 * Crea al propietario a partir de ADMIN_EMAIL / ADMIN_PASSWORD cuando no hay ninguno (la primera vez, o tras borrar su fila).
 * Las demás personas se invitan desde Panel → Equipo; estas variables no sirven para agregarlas.
 * Si ya existe uno, no toca nada (cambiar las variables después no cambia la contraseña).
 */
export async function seedAdminFromEnv(
  source: { ADMIN_EMAIL?: string; ADMIN_PASSWORD?: string },
  db: Database = getDb(),
): Promise<SeedResult> {
  // Basta con que exista un propietario: así, si se borra su fila para recuperar la contraseña, las demás cuentas no estorban.
  if ((await countOwners(db)) > 0) return "exists";
  const email = source.ADMIN_EMAIL ? normalizeEmail(source.ADMIN_EMAIL) : "";
  const password = source.ADMIN_PASSWORD ?? "";
  if (!email || !password) return "missing-env";
  if (!email.includes("@") || password.length < MIN_PASSWORD_LENGTH) return "invalid";
  // El primero que se crea es el propietario: administra el equipo.
  await insertAdmin(db, { email, passwordHash: await hashPassword(password), role: "owner" });
  return "created";
}

export type AuthResult = { ok: true; admin: AdminSummary } | { ok: false };

/** Comprueba credenciales. Tarda lo mismo exista o no el correo, para no revelarlo. */
export async function authenticate(
  email: string,
  password: string,
  db: Database = getDb(),
): Promise<AuthResult> {
  const admin = await findAdminByEmail(db, normalizeEmail(email));
  const valid = await verifyPassword(password, admin?.passwordHash ?? (await getDummyHash()));
  if (!admin || !valid) return { ok: false };
  return { ok: true, admin: summarize(admin) };
}

/**
 * Confirma que la sesión sigue siendo válida: el admin existe y no cambió su contraseña
 * desde que se emitió el token.
 */
export async function resolveSession(
  claims: SessionClaims,
  db: Database = getDb(),
): Promise<AdminSummary | null> {
  const admin = await findAdminById(db, claims.sub);
  if (!admin) return null;
  const summary = summarize(admin);
  return summary.pv === claims.pv ? summary : null;
}
