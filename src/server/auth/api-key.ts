import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "pagespeed_";

/** `pagespeed_` + 32 bytes aleatorios en base64url (43 caracteres). Solo se muestra una vez al crearla. */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** Lo único que se guarda de una clave: su sha256 en hexadecimal. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const KEY_RE = /^pagespeed_[A-Za-z0-9_-]{43}$/;
export const isPlausibleApiKey = (key: string) => KEY_RE.test(key);

/** Saca la clave de una cabecera `Authorization: Bearer ...`. null si falta o está mal formada. */
export function parseBearer(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return m?.[1] ?? null;
}
