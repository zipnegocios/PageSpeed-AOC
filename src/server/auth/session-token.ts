import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

const ISSUER = "pagespeed";
const AUDIENCE = "admin";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionClaims = {
  /** id del administrador */
  sub: string;
  email: string;
  /** versión de la contraseña: cambiarla invalida las sesiones anteriores */
  pv: string;
};

/** Huella corta del hash de la contraseña. No permite recuperar el hash. */
export function passwordVersion(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

function key(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(
  claims: SessionClaims,
  secret: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAt + SESSION_TTL_SECONDS;
  const token = await new SignJWT({ email: claims.email, pv: claims.pv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(key(secret));
  return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
}

/** Devuelve los claims si el token es válido y no ha vencido; null en cualquier otro caso. */
export async function readSessionToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
    });
    if (typeof payload.sub !== "string") return null;
    if (typeof payload.email !== "string" || typeof payload.pv !== "string") return null;
    return { sub: payload.sub, email: payload.email, pv: payload.pv };
  } catch {
    return null;
  }
}
