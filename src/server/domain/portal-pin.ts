import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const PIN_LENGTH = 6;
const PIN_RE = /^\d{6}$/;

export const isPin = (value: string): boolean => PIN_RE.test(value);

/** Seis dígitos al azar con aleatoriedad criptográfica, con ceros a la izquierda ("004217"). */
export function generatePin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
}

/**
 * Huella del PIN: HMAC-SHA256 con una clave del servidor y el id del cliente. Un PIN de 6 dígitos no resiste un
 * ataque offline por sí solo; la clave del servidor impide calcularlo con solo una copia de la base de datos.
 */
export function hashPin(clientId: string, pin: string, secret: string): string {
  return createHmac("sha256", secret).update(`${clientId}:${pin}`).digest("hex");
}

/** Comparación en tiempo constante. Un cliente sin PIN nunca coincide. */
export function pinMatches(storedHash: string | null | undefined, clientId: string, pin: string, secret: string): boolean {
  const candidate = Buffer.from(hashPin(clientId, pin, secret), "hex");
  const stored = Buffer.from(storedHash ?? "", "hex");
  const ok = stored.length === candidate.length && timingSafeEqual(stored, candidate);
  return Boolean(storedHash) && ok;
}
