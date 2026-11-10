import { getDb, type Database } from "@/server/db/client";
import { FIELD_LABEL, FIELD_METRICS, assess, formatField, rate, type Assessment, type FieldMetric, type Rating } from "@/server/domain/field-data";
import { measurementStates, type MeasurementId, type MeasurementState } from "@/server/domain/measurements";
import * as seoPortal from "@/server/repositories/seo-portal";
import { findFieldData } from "./crux";
import { getPortalTraffic, type PortalTraffic } from "./portal-traffic";
import { assertUuid } from "./shared";

/** Experiencia real de los visitantes (Chrome UX Report): las tres métricas de Core Web Vitals y el veredicto. */
export type PortalField = {
  assessment: Assessment;
  device: "mobile" | "desktop";
  first: string | null;
  last: string | null;
  /** LCP, INP y CLS (`core`) siempre; FCP y TTFB solo si Google los entregó. `good`/`needsImprovement`/`poor`: % de visitas. */
  metrics: Array<{ metric: FieldMetric; core: boolean; label: string; value: string; rating: Rating | null; good: number; needsImprovement: number; poor: number }>;
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
  /** Cada dispositivo con datos reales (móvil primero); `field` es el primero. */
  fields: PortalField[];
  states: Record<MeasurementId, MeasurementState>;
};

const CORE: readonly FieldMetric[] = ["lcp", "inp", "cls"];

async function loadFields(projectId: string, db: Database): Promise<PortalField[]> {
  const out: PortalField[] = [];
  // El móvil primero (es el que Google usa para posicionar); el escritorio, si tiene datos.
  for (const device of ["mobile", "desktop"] as const) {
    const view = await findFieldData(projectId, "origin", device, db);
    if (view?.status !== "ok" || !view.metrics) continue;
    const metrics = FIELD_METRICS.flatMap((metric) => {
      const m = view.metrics?.[metric];
      const core = CORE.includes(metric);
      if (!m && !core) return [];
      const p75 = m?.p75 ?? null;
      return [{ metric, core, label: FIELD_LABEL[metric], value: formatField(metric, p75), rating: rate(metric, p75), good: m?.good ?? 0, needsImprovement: m?.needsImprovement ?? 0, poor: m?.poor ?? 0 }];
    });
    out.push({ assessment: assess(view.metrics), device, first: view.first, last: view.last, metrics });
  }
  return out;
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
  const [traffic, fields] = await Promise.all([seoAccess ? getPortalTraffic(clientId, project, { days: opts.days }, db) : Promise.resolve(null), loadFields(project.id, db)]);
  const field = fields[0] ?? null;
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
  return { days: opts.days, seoAccess, traffic, field, fields, states };
}
