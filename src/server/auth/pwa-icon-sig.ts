import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de las direcciones de los iconos de la app instalada. El navegador pide el icono del manifiesto (y el de la
 * pantalla de inicio de iOS) sin cookies, así que no puede exigir el PIN. En su lugar, el manifiesto (que sí se pide con
 * sesión) trae direcciones firmadas: sin una firma válida, nadie obtiene el icono de un cliente adivinando su enlace.
 */
const sig = (secret: string, token: string, v: string) => createHmac("sha256", secret).update(`pwa-icon:${token}:${v}`).digest("base64url").slice(0, 27);

export function signPwaIcon(secret: string, token: string, v: string): string {
  return sig(secret, token, v);
}

export function verifyPwaIcon(secret: string, token: string, v: string, given: string): boolean {
  const a = Buffer.from(sig(secret, token, v));
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
