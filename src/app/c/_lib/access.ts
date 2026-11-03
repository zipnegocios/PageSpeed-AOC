import { notFound } from "next/navigation";
import { clientIp } from "@/lib/auth/client-ip";
import { portalLimiter } from "@/lib/auth/portal-limiter";
import { resolvePortal, type PortalAccess } from "@/server/services/portal";

export type Access = Extract<PortalAccess, { state: "ok" | "suspended" }> | { state: "blocked" };

/**
 * Resuelve el link mágico de la petición. Un enlace inválido cuenta como intento fallido de la IP;
 * pasado el límite se corta con un aviso, sin consultar más la base de datos. El token se vuelve a
 * comprobar en cada petición, así que rotarlo o suspender al cliente surte efecto al instante.
 */
export async function portalAccess(token: string): Promise<Access> {
  const ip = await clientIp();
  if (portalLimiter.isBlocked(ip)) return { state: "blocked" };
  const access = await resolvePortal(token);
  if (access.state === "invalid") {
    portalLimiter.recordFailure(ip);
    notFound();
  }
  return access;
}
