import { notFound } from "next/navigation";
import { cache } from "react";
import { clientIp } from "@/lib/auth/client-ip";
import { hasPortalSession } from "@/lib/auth/portal-session";
import { portalLimiter } from "@/lib/auth/portal-limiter";
import { resolvePortal, type PortalAccess } from "@/server/services/portal";

export type Access = Extract<PortalAccess, { state: "ok" | "suspended" | "pin" | "legacy" }> | { state: "blocked" };
export type CheckedAccess = Access | { state: "invalid" };

/**
 * Resuelve el enlace del portal de la petición. Un enlace inválido cuenta como intento fallido de la IP; pasado el
 * límite se corta con un aviso, sin consultar más la base de datos. Se vuelve a comprobar en cada petición (y se
 * comparte dentro de una misma petición: los metadatos, el marco y la página no repiten la consulta ni los intentos fallidos).
 */
export const checkPortal = cache(async (ref: string): Promise<CheckedAccess> => {
  const ip = await clientIp();
  if (portalLimiter.isBlocked(ip)) return { state: "blocked" };
  const access = await resolvePortal(ref, hasPortalSession);
  if (access.state === "invalid") portalLimiter.recordFailure(ip);
  return access;
});

/** Igual que `checkPortal`, pero un enlace inválido se convierte en la página 404 del portal. */
export async function portalAccess(ref: string): Promise<Access> {
  const access = await checkPortal(ref);
  if (access.state === "invalid") notFound();
  return access;
}
