import { DomainError } from "./errors";
import { isHostAllowed } from "./url-guard";

export type Profile = "mobile" | "desktop";
export const PROFILES: readonly Profile[] = ["mobile", "desktop"];
export type Phase = "development" | "production";
export type AuditTrigger = "manual" | "scheduled" | "mcp";

/**
 * Perfiles que se auditan según la fase:
 * - Desarrollo: una sola página y **un solo perfil**, el que se indique.
 * - Producción manual: uno o ambos (por defecto ambos).
 * - Producción programada: siempre ambos.
 */
export function planProfiles(phase: Phase, requested: Profile[] | undefined, trigger: AuditTrigger): Profile[] {
  const unique = [...new Set(requested ?? [])];
  if (unique.some((p) => !PROFILES.includes(p))) throw new DomainError("INVALID", "Perfil no válido.");

  if (trigger === "scheduled") return phase === "production" ? [...PROFILES] : [];
  if (phase === "development") {
    if (unique.length !== 1) {
      throw new DomainError("INVALID", "En desarrollo se audita un perfil a la vez. Elige móvil o escritorio.");
    }
    return unique;
  }
  return unique.length === 0 ? [...PROFILES] : unique;
}

/** La URL de la ruta debe seguir dentro de los hosts permitidos del proyecto. */
export function assertRouteAuditable(routeUrl: string, allowedHosts: string[]): void {
  let host: string;
  try {
    host = new URL(routeUrl).hostname;
  } catch {
    throw new DomainError("INVALID", "La URL de la ruta no es válida.");
  }
  if (!isHostAllowed(host, allowedHosts)) {
    throw new DomainError("FORBIDDEN_HOST", `El host ${host} ya no está en los hosts permitidos del proyecto.`);
  }
}
