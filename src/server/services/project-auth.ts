import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { decryptJson, encryptJson, keyStatus, SecretBoxError, type KeyStatus } from "@/server/crypto/secret-box";
import { DomainError } from "@/server/domain/errors";
import { parseCookieText, projectAuthSchema, summarize, type AuthSummary, type ProjectAuthConfig } from "@/server/domain/project-auth";
import { assertHostAllowed, parseHttpUrl } from "@/server/domain/url-guard";
import { findProject } from "@/server/repositories/projects";
import { assertUuid, parseInput } from "./shared";

const keyOf = (key?: string) => key ?? process.env.AUTH_ENCRYPTION_KEY;

export function authKeyStatus(key?: string): KeyStatus {
  return keyStatus(keyOf(key));
}

/** La clave de cifrado de credenciales, o un error legible si falta o no es válida. */
export function requireEncryptionKey(key?: string): string {
  const k = keyOf(key);
  const status = keyStatus(k);
  if (status === "missing") throw new DomainError("INVALID", "Falta AUTH_ENCRYPTION_KEY en el servicio. Defínela (openssl rand -base64 32) en el web y en el worker antes de guardar credenciales.");
  if (status === "invalid") throw new DomainError("INVALID", "AUTH_ENCRYPTION_KEY no es válida: debe ser de 32 bytes en base64 (openssl rand -base64 32).");
  return k!;
}

/** Acepta "/login" o una URL completa; el resultado debe caer en un host permitido del proyecto. */
function resolveLoginUrl(raw: string, baseUrl: string, allowedHosts: string[]): string {
  let url: URL;
  try {
    url = raw.trim().startsWith("/") ? new URL(raw.trim(), baseUrl) : parseHttpUrl(raw.trim());
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("INVALID", "La dirección de inicio de sesión no es válida.");
  }
  assertHostAllowed(url, allowedHosts);
  url.hash = "";
  return url.toString();
}

export type AuthInput =
  | { strategy: "cookie"; cookies: string }
  | {
      strategy: "form";
      loginUrl: string;
      username: string;
      password: string;
      usernameSelector?: string;
      passwordSelector?: string;
      submitSelector?: string;
      successSelector?: string;
    };

/** Guarda (cifrada) la forma de entrar a las páginas privadas del proyecto. Reemplaza la anterior. */
export async function setProjectAuth(
  projectId: string,
  input: AuthInput,
  db: Database = getDb(),
  options: { key?: string } = {},
): Promise<AuthSummary> {
  assertUuid(projectId, "Proyecto");
  const key = requireEncryptionKey(options.key);
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");

  const blank = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);
  const candidate =
    input.strategy === "cookie"
      ? { strategy: "cookie" as const, cookies: parseCookieText(input.cookies) }
      : {
          strategy: "form" as const,
          loginUrl: resolveLoginUrl(input.loginUrl, project.baseUrl, project.allowedHosts),
          username: input.username,
          password: input.password,
          usernameSelector: blank(input.usernameSelector),
          passwordSelector: blank(input.passwordSelector),
          submitSelector: blank(input.submitSelector),
          successSelector: blank(input.successSelector),
        };
  const config = parseInput(projectAuthSchema, candidate);
  await db
    .update(projects)
    .set({ authStrategy: config.strategy === "cookie" ? "cookie" : "script", authConfigEnc: encryptJson(config, key) })
    .where(eq(projects.id, projectId));
  return summarize(config);
}

export async function clearProjectAuth(projectId: string, db: Database = getDb()): Promise<void> {
  assertUuid(projectId, "Proyecto");
  const rows = await db
    .update(projects)
    .set({ authStrategy: "none", authConfigEnc: null })
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id });
  if (rows.length === 0) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
}

/** Lo que se puede mostrar de la configuración: nunca contraseñas ni valores de cookies. */
export async function getProjectAuthSummary(projectId: string, db: Database = getDb(), options: { key?: string } = {}): Promise<AuthSummary> {
  assertUuid(projectId, "Proyecto");
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  if (project.authStrategy === "none" || !project.authConfigEnc) return { configured: false };
  const strategy = project.authStrategy === "cookie" ? "cookie" : "form";
  try {
    return summarize(parseInput(projectAuthSchema, decryptJson(project.authConfigEnc, keyOf(options.key))));
  } catch {
    return { configured: true, strategy, unreadable: true };
  }
}

/** Para el worker: la configuración descifrada, o null si el proyecto no tiene acceso configurado. */
export function resolveProjectAuth(
  project: { authStrategy: string; authConfigEnc: Buffer | null },
  key: string | undefined,
): ProjectAuthConfig | null {
  if (project.authStrategy === "none" || !project.authConfigEnc) return null;
  try {
    return parseInput(projectAuthSchema, decryptJson(project.authConfigEnc, key));
  } catch (err) {
    if (err instanceof SecretBoxError) throw err;
    throw new SecretBoxError("DECRYPT_FAILED", "La configuración de acceso guardada no es válida.");
  }
}
