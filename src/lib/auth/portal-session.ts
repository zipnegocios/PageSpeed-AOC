import "server-only";
import { cookies } from "next/headers";
import { PORTAL_SESSION_TTL_SECONDS, readPortalSession, signPortalSession } from "@/server/auth/portal-session";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET no está definida o tiene menos de 32 caracteres");
  return value;
}

/** Una cookie por cliente (varios clientes pueden convivir en un mismo navegador). Vale para todo el portal. */
const cookieName = (clientId: string) => `pagespeed_portal_${clientId.replace(/-/g, "").slice(0, 16)}`;

export async function setPortalSession(client: { id: string; pinVersion: number }): Promise<void> {
  const { token, expiresAt } = await signPortalSession({ sub: client.id, pv: client.pinVersion }, secret());
  const store = await cookies();
  store.set(cookieName(client.id), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/c",
    maxAge: PORTAL_SESSION_TTL_SECONDS,
    expires: expiresAt,
  });
}

/** ¿El navegador trae una sesión vigente para este cliente y para su PIN actual? */
export async function hasPortalSession(client: { id: string; pinVersion: number }): Promise<boolean> {
  const token = (await cookies()).get(cookieName(client.id))?.value;
  if (!token) return false;
  const claims = await readPortalSession(token, secret());
  return claims !== null && claims.sub === client.id && claims.pv === client.pinVersion;
}
