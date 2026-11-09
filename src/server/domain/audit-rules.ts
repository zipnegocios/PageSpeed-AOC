import { DomainError } from "./errors";
import { isHostAllowed } from "./url-guard";

export type Profile = "mobile" | "desktop";
export const PROFILES: readonly Profile[] = ["mobile", "desktop"];
export type Phase = "development" | "production";
export type AuditTrigger = "manual" | "scheduled" | "mcp";

/**
 * Perfiles que se auditan según la fase:
 * - Manual (en cualquier fase): uno o ambos perfiles; sin indicar ninguno, ambos.
 * - Programada: siempre ambos, y solo en producción (en desarrollo no hay auditorías programadas).
 */
export function planProfiles(phase: Phase, requested: Profile[] | undefined, trigger: AuditTrigger): Profile[] {
  const unique = [...new Set(requested ?? [])];
  if (unique.some((p) => !PROFILES.includes(p))) throw new DomainError("INVALID", "Perfil no válido.");

  if (trigger === "scheduled") return phase === "production" ? [...PROFILES] : [];
  return unique.length === 0 ? [...PROFILES] : unique;
}

export type FirstScanRoute = { id: string; path: string; monitored: boolean; requiresAuth: boolean };
/** Un dispositivo de una ruta que ya tiene una auditoría correcta o una pendiente (en cola o en curso). */
export type CoveredProfile = { routeId: string; profile: Profile; state: "succeeded" | "pending" };

export type FirstScanPlan = {
  /** Rutas a encolar y los dispositivos que les faltan, en orden de ruta. */
  targets: { routeId: string; profiles: Profile[] }[];
  /** Auditorías que se crearían (suma de dispositivos de `targets`). */
  toQueue: number;
  /** Dispositivos que ya estaban en cola o en curso. */
  alreadyPending: number;
  /** Rutas omitidas porque piden iniciar sesión y el proyecto no tiene el acceso configurado. */
  skippedAuth: number;
  /** Rutas con algo por escanear que no caben en el cupo de la cola. */
  routesWithoutRoom: number;
};

/**
 * Plan del «primer escaneo»: por cada ruta monitoreada, los dispositivos sin auditoría correcta ni pendiente
 * (lo que falló antes se vuelve a intentar). Las rutas que piden sesión se omiten si no hay acceso configurado.
 * `budget` es el cupo de trabajos que admite la cola: se llena ruta a ruta, con los dos dispositivos juntos,
 * y lo que no cabe se cuenta en `routesWithoutRoom`.
 */
export function planFirstScan(input: {
  routes: FirstScanRoute[];
  covered: CoveredProfile[];
  authConfigured: boolean;
  budget: number;
}): FirstScanPlan {
  const byRoute = new Map<string, Map<Profile, CoveredProfile["state"]>>();
  for (const c of input.covered) {
    const map = byRoute.get(c.routeId) ?? new Map<Profile, CoveredProfile["state"]>();
    // «Correcta» pesa más que «pendiente»; ambas cuentan como cubierto.
    if (map.get(c.profile) !== "succeeded") map.set(c.profile, c.state);
    byRoute.set(c.routeId, map);
  }

  const plan: FirstScanPlan = { targets: [], toQueue: 0, alreadyPending: 0, skippedAuth: 0, routesWithoutRoom: 0 };
  let left = Math.max(0, input.budget);
  const ordered = input.routes.filter((r) => r.monitored).sort((a, b) => a.path.localeCompare(b.path));

  for (const route of ordered) {
    const covered = byRoute.get(route.id);
    const missing = PROFILES.filter((p) => !covered?.has(p));
    for (const p of PROFILES) if (covered?.get(p) === "pending") plan.alreadyPending++;
    if (missing.length === 0) continue;
    if (route.requiresAuth && !input.authConfigured) {
      plan.skippedAuth++;
      continue;
    }
    if (missing.length > left) {
      plan.routesWithoutRoom++;
      continue;
    }
    left -= missing.length;
    plan.toQueue += missing.length;
    plan.targets.push({ routeId: route.id, profiles: missing });
  }
  return plan;
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
