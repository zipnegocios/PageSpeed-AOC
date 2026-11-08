import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado autenticado (AES-256-GCM) para credenciales guardadas en la base de datos.
 * Formato del binario: versión (1 byte) | IV (12) | etiqueta de autenticación (16) | texto cifrado.
 * La clave vive solo en el entorno (AUTH_ENCRYPTION_KEY), nunca en la base ni en los respaldos.
 */
export class SecretBoxError extends Error {
  constructor(
    public readonly code: "NO_KEY" | "BAD_KEY" | "DECRYPT_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "SecretBoxError";
  }
}

const VERSION = 1;
// OJO: este valor conserva el nombre histórico del producto («aoc») a propósito. Es dato autenticado del cifrado AES-GCM:
// cambiarlo dejaría ilegibles las credenciales ya guardadas. No renombrar sin migrar esos datos.
const AAD = Buffer.from("aoc-auth-v1");

/** Clave de 32 bytes en base64 (`openssl rand -base64 32`). */
export function parseKey(keyB64: string | undefined | null): Buffer {
  if (!keyB64) throw new SecretBoxError("NO_KEY", "Falta AUTH_ENCRYPTION_KEY en el entorno.");
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new SecretBoxError("BAD_KEY", "AUTH_ENCRYPTION_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32).");
  return key;
}

export type KeyStatus = "ok" | "missing" | "invalid";

export function keyStatus(keyB64: string | undefined | null): KeyStatus {
  try {
    parseKey(keyB64);
    return "ok";
  } catch (err) {
    return err instanceof SecretBoxError && err.code === "NO_KEY" ? "missing" : "invalid";
  }
}

export function encryptJson(value: unknown, keyB64: string | undefined | null): Buffer {
  const key = parseKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function decryptJson<T = unknown>(data: Buffer, keyB64: string | undefined | null): T {
  const key = parseKey(keyB64);
  if (data.length < 1 + 12 + 16 + 1 || data[0] !== VERSION) throw new SecretBoxError("DECRYPT_FAILED", "El dato cifrado no tiene un formato válido.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(1, 13));
    decipher.setAAD(AAD);
    decipher.setAuthTag(data.subarray(13, 29));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString("utf8")) as T;
  } catch {
    // Clave distinta o dato manipulado: no se distingue ni se detalla.
    throw new SecretBoxError("DECRYPT_FAILED", "No se pudo descifrar: la clave no coincide o el dato está dañado.");
  }
}
