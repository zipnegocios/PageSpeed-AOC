import { getDb, type Database } from "@/server/db/client";
import { FIELD_LABEL, assess, formatField, rate, type Assessment, type FieldMetric, type Rating } from "@/server/domain/field-data";
import { measurementStates, type MeasurementId, type MeasurementState } from "@/server/domain/measurements";
import * as seoPortal from "@/server/repositories/seo-portal";
import { findFieldData } from "./crux";
import { getPortalTraffic, type PortalTraffic } from "./portal-traffic";
import { assertUuid } from "./shared";

/** Experiencia real de los visitantes (Chrome UX Report): las tres métricas de Core Web Vitals y el veredicto. */
export type PortalField = {
  assessment: Assessment;
  device: "mobile" | "desktop";
  last: string | null;
  metrics: Array<{ metric: FieldMetric; label: string; value: string; rating: Rating | null }>;
};

/**
 * Todo lo que se mide de un proyecto, listo para resumir al cliente: velocidad (Lighthouse) lo aporta el portal; aquí vienen la experiencia
 * real, las visitas y su origen, la búsqueda en Google, la IA y la salud SEO. Una sola puerta de acceso, la misma de la pestaña Tráfico.
 */
export type PortalMeasurements = {
  days: number;
  /** El administrador activó el seguimiento de tráfico y búsqueda para este proyecto. */
  seoAccess: boolean;
  traffic: PortalTraffic | null;
  field: PortalField | null;
  states: Record<MeasurementId, MeasurementState>;
};

async function loadField(projectId: string, db: Database): Promise<PortalField | null> {
  // Se prefiere el móvil (es el que Google usa para posicionar); si no hay datos de móvil, el escritorio.
  for (const device of ["mobile", "desktop"] as const) {
    const view = await findFieldData(projectId, "origin", device, db);
    if (view?.status !== "ok" || !view.metrics) continue;
    const result = assess(view.metrics);
    return {
      assessment: result,
      device,
      last: view.last,
      metrics: (["lcp", "inp", "cls"] as const).map((metric) => {
        const p75 = view.metrics?.[metric]?.p75 ?? null;
        return { metric, label: FIELD_LABEL[metric], value: formatField(metric, p75), rating: rate(metric, p75) };
      }),
    };
  }
  return null;
}

/** Las mediciones del proyecto para el cliente (`days`: 7, 28 o 90). `hasLighthouse`: ya hay auditorías, que se leen en el portal. */
export async function getPortalMeasurements(
  clientId: string,
  project: { id: string; name: string },
  opts: { days: number; hasLighthouse: boolean },
  db: Database = getDb(),
): Promise<PortalMeasurements> {
  assertUuid(clientId, "Cliente");
  assertUuid(project.id, "Proyecto");
  const seoAccess = (await seoPortal.findPortalSeoProject(db, clientId, project.id)) !== null;
  const [traffic, field] = await Promise.all([seoAccess ? getPortalTraffic(clientId, project, { days: opts.days }, db) : Promise.resolve(null), loadField(project.id, db)]);
  const d = traffic?.dashboard ?? null;
  const states = measurementStates({
    seoAccess,
    has: {
      speed: opts.hasLighthouse,
      improvements: opts.hasLighthouse,
      field: field !== null,
      search: d?.search != null,
      traffic: d?.traffic != null,
      sources: d?.sources != null,
      ai: d?.ai != null,
      health: traffic?.health != null,
    },
  });
  return { days: opts.days, seoAccess, traffic, field, states };
}
