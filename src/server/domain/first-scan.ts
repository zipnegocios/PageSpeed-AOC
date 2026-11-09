import { assertRouteAuditable, PROFILES, type Profile } from "./audit-rules";

/**
 * Primer escaneo de un proyecto: audita en móvil y escritorio las rutas que todavía no tienen auditoría.
 * Lógica pura: decide qué rutas y perfiles faltan y redacta el resultado para la persona administradora.
 */

export type ScanRoute = { id: string; url: string; requiresAuth: boolean };
export type FirstScanItem = { routeId: string; profiles: Profile[] };

export type FirstScanPlan = {
  items: FirstScanItem[];
  /** Auditorías por lanzar (rutas × perfiles que faltan). */
  audits: number;
  /** Rutas que requieren sesión y el proyecto no tiene acceso configurado: se dejan para después. */
  skippedAuth: number;
  /** Rutas cuyo host ya no está permitido en el proyecto. */
  skippedHost: number;
};

/** Clave de una auditoría ya cubierta: `rutaId|perfil`. */
export const coveredKey = (routeId: string, profile: Profile): string => `${routeId}|${profile}`;

/**
 * Una ruta y perfil cuentan como cubiertos si ya hay una auditoría en cola, en curso o terminada con éxito.
 * Una que falló no cuenta: el primer escaneo la vuelve a intentar.
 */
export function planFirstScan(routes: ScanRoute[], covered: ReadonlySet<string>, opts: { authConfigured: boolean; allowedHosts: string[] }): FirstScanPlan {
  const items: FirstScanItem[] = [];
  let audits = 0;
  let skippedAuth = 0;
  let skippedHost = 0;

  for (const route of routes) {
    const profiles = PROFILES.filter((p) => !covered.has(coveredKey(route.id, p)));
    if (profiles.length === 0) continue;
    if (route.requiresAuth && !opts.authConfigured) {
      skippedAuth += 1;
      continue;
    }
    try {
      assertRouteAuditable(route.url, opts.allowedHosts);
    } catch {
      skippedHost += 1;
      continue;
    }
    items.push({ routeId: route.id, profiles: [...profiles] });
    audits += profiles.length;
  }
  return { items, audits, skippedAuth, skippedHost };
}

export type FirstScanResult = {
  /** Auditorías creadas y puestas en la cola. */
  queued: number;
  /** Rutas en las que se creó al menos una auditoría. */
  routesQueued: number;
  /** Auditorías que ya estaban pendientes (otra persona las lanzó un momento antes). */
  alreadyPending: number;
  /** Auditorías que no entraron porque la cola alcanzó su límite. */
  remaining: number;
  skippedAuth: number;
  skippedHost: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Resultado del primer escaneo en palabras normales. */
export function describeFirstScan(r: FirstScanResult): string {
  const parts: string[] = [];
  if (r.queued > 0) {
    parts.push(
      `Primer escaneo en cola: ${plural(r.queued, "auditoría", "auditorías")} (móvil y escritorio) de ${plural(r.routesQueued, "ruta", "rutas")}. El worker las procesa de una en una; los resultados irán apareciendo en cada ruta.`,
    );
  } else if (r.alreadyPending === 0 && r.remaining === 0 && r.skippedAuth === 0 && r.skippedHost === 0) {
    return "Todas las rutas ya tienen su primer escaneo.";
  }
  if (r.alreadyPending > 0) parts.push(`${plural(r.alreadyPending, "auditoría ya estaba pendiente", "auditorías ya estaban pendientes")}.`);
  if (r.remaining > 0) parts.push(`La cola tiene un límite: ${plural(r.remaining, "auditoría quedó", "auditorías quedaron")} sin encolar. Cuando la cola avance, vuelve a pulsar el botón.`);
  if (r.skippedAuth > 0) parts.push(`Se omitieron ${plural(r.skippedAuth, "ruta que requiere", "rutas que requieren")} sesión: configura «Acceso a páginas privadas» y vuelve a pulsar.`);
  if (r.skippedHost > 0) parts.push(`Se omitieron ${plural(r.skippedHost, "ruta", "rutas")} porque su host ya no está permitido en el proyecto.`);
  return parts.join(" ");
}
