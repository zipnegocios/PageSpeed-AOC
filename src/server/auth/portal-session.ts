import { jwtVerify, SignJWT } from "jose";

const ISSUER = "pagespeed";
const AUDIENCE = "portal";
/** Cuánto dura la sesión del cliente tras escribir su PIN. */
export const PORTAL_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type PortalSessionClaims = {
  /** id del cliente */
  sub: string;
  /** versión del PIN: un PIN nuevo invalida las sesiones anteriores */
  pv: number;
};

function key(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  return new TextEncoder().encode(secret);
}

export async function signPortalSession(claims: PortalSessionClaims, secret: string, now: Date = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAt + PORTAL_SESSION_TTL_SECONDS;
  const token = await new SignJWT({ pv: claims.pv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(key(secret));
  return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
}

/** Los claims si el token es válido, de este tipo y no ha vencido; null en cualquier otro caso. */
export async function readPortalSession(token: string, secret: string, now: Date = new Date()): Promise<PortalSessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE, currentDate: now });
    if (typeof payload.sub !== "string" || typeof payload.pv !== "number") return null;
    return { sub: payload.sub, pv: payload.pv };
  } catch {
    return null;
  }
}
