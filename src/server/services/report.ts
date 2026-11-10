import { getDb, type Database } from "@/server/db/client";
import { metricValue, periodStart, type HistoryMetric, type Period } from "@/server/domain/history";
import type { AuditImprovements } from "@/server/domain/improvements";
import type { MeasurementId, MeasurementState } from "@/server/domain/measurements";
import { REPORT_FILE_PREFIX, type ReportKind } from "@/server/domain/report-outline";
import * as history from "@/server/repositories/history";
import { listOpenAlerts } from "./alerts";
import { getAudit } from "./audits";
import { readClientLogo } from "./client-logo";
import { getClient } from "./clients";
import { getLatestScores, type LatestScores } from "./history";
import { loadAuditImprovements } from "./audit-improvements";
import { getPortalImprovements, portalPageTitles, type PortalImprovements, type PortalProject } from "./portal";
import type { PortalTraffic } from "./portal-traffic";
import { getPortalMeasurements, type PortalField } from "./project-measurements";
import { getProject } from "./projects";
import { getThresholds } from "./thresholds";

type Profile = "mobile" | "desktop";
const OTHER_SCORES = ["seo", "accessibility", "best_practices"] as const satisfies readonly HistoryMetric[];
const MAX_CHARTS = 8;
/** Cuántas páginas (las más débiles) se detallan en el informe de ingeniería. */
export const ENGINEERING_DETAIL_ROUTES = 30;

export type RangeSummary = { metric: HistoryMetric; first: number; last: number; min: number; max: number };

export type ReportChart = {
  routePath: string;
  profile: Profile;
  points: Array<{ at: Date; value: number }>;
  ranges: RangeSummary[];
};

/** El logotipo del cliente para la cabecera de los informes: siempre PNG (lo único que el PDF admite además de JPEG). */
export type ReportLogo = { bytes: Buffer; bg: string | null };

export type ReportData = {
  kind: ReportKind;
  generatedAt: Date;
  days: Period;
  from: Date;
  clientName: string;
  contactName: string | null;
  contactEmail: string | null;
  projectId: string;
  projectName: string;
  baseUrl: string;
  /** Meta de rendimiento, para dibujarla en los gráficos. */
  performanceThreshold: number | null;
  latest: LatestScores[];
  improvements: Array<{ routePath: string; profile: Profile; text: string }>;
  charts: ReportChart[];
  /** Logotipo completo del cliente (o, a falta de él, su isotipo); null si no tiene. */
  logo: ReportLogo | null;
  /** El título que ve el cliente de cada ruta (no su dirección). */
  titles: Record<string, string>;
  /** Mejoras abiertas, página por página, con sus causas en frases llanas. */
  pageImprovements: PortalImprovements;
  /** Tráfico, búsqueda y salud SEO: solo si el cliente puede verlos en su portal (si no, null). */
  seo: PortalTraffic | null;
  /** Experiencia real de los visitantes (Chrome UX Report): un elemento por dispositivo con datos, móvil primero. Vacío si no hay. */
  fields: PortalField[];
  /** Qué mediciones están incluidas, sin datos aún o no activadas para el cliente: decide el motivo que lleva cada apartado. */
  states: Record<MeasurementId, MeasurementState>;
  /** Rendimiento medio por día (UTC) del periodo, de más antiguo a más reciente. */
  daily: Array<{ day: string; value: number }>;
  /**
   * Solo en el informe de ingeniería: las páginas más débiles (hasta `ENGINEERING_DETAIL_ROUTES`), un elemento por página y
   * dispositivo, con lo que Lighthouse encontró. `improvements` es null si esa auditoría no tiene detalle guardado.
   */
  detail: Array<{ routeId: string; path: string; profile: Profile; scores: LatestScores["scores"]; metrics: LatestScores["metrics"]; agentic: LatestScores["agentic"]; improvements: AuditImprovements | null }>;
  /** Versión de Lighthouse de la medición más reciente. */
  lighthouseVersion: string | null;
  /** Metas acordadas por rubro. */
  thresholds: Array<{ metric: string; minScore: number }>;
};

/** El periodo del informe → el periodo de «Tráfico y búsqueda» (7, 28 o 90 días): 30 → 28 y un año → 90. */
export const seoDaysFor = (days: Period): 7 | 28 | 90 => (days === 7 ? 7 : days === 90 || days === 365 ? 90 : 28);

/** Las rutas con peor nota primero (la más débil de sus dispositivos), para los topes de los informes. */
export function worstFirst(latest: LatestScores[]): LatestScores[] {
  const worst = new Map<string, number>();
  for (const l of latest) worst.set(l.routeId, Math.min(worst.get(l.routeId) ?? 101, l.scores.performance ?? 101));
  return [...latest].sort((a, b) => (worst.get(a.routeId)! - worst.get(b.routeId)!) || a.path.localeCompare(b.path) || a.profile.localeCompare(b.profile));
}

/** Todo lo que el informe necesita, sin tocar ni PDF ni correo. El llamador valida el acceso al proyecto. */
export async function buildProjectReport(
  projectId: string,
  options: { days?: Period; now?: Date; kind?: ReportKind } = {},
  db: Database = getDb(),
): Promise<ReportData> {
  const days = options.days ?? 30;
  const kind = options.kind ?? "summary";
  const now = options.now ?? new Date();
  const project = await getProject(projectId, db);
  const client = await getClient(project.clientId, db);
  const [latest, alerts, thresholds] = await Promise.all([
    getLatestScores(project.id, db),
    listOpenAlerts(project.id, db),
    getThresholds(project.id, db),
  ]);
  const from = periodStart(now, days);

  const charts: ReportChart[] = [];
  // Gráficas de las rutas más débiles: son las que hay que mirar.
  for (const l of worstFirst(latest).slice(0, MAX_CHARTS)) {
    const rows = await history.listSeries(db, l.routeId, l.profile, from);
    const series = (m: HistoryMetric) =>
      rows.flatMap((r) => {
        const v = metricValue(r, m);
        return v === null ? [] : [{ at: r.finishedAt, value: v }];
      });
    const ranges = OTHER_SCORES.flatMap((m): RangeSummary[] => {
      const s = series(m).map((p) => p.value);
      return s.length === 0
        ? []
        : [{ metric: m, first: s[0]!, last: s.at(-1)!, min: Math.min(...s), max: Math.max(...s) }];
    });
    charts.push({ routePath: l.path, profile: l.profile, points: series("performance"), ranges });
  }

  // Lo que cuelga del portal (títulos, causas de las mejoras y tráfico/SEO) sale de los mismos servicios que la pantalla del cliente.
  const portalProject: PortalProject = { id: project.id, slug: project.slug, name: project.name, baseUrl: project.baseUrl, latest, improvements: [] };
  const [titles, pageImprovements, measurements, daily, logo, newest] = await Promise.all([
    portalPageTitles(portalProject, latest.map((l) => l.path), db),
    getPortalImprovements(portalProject, db),
    getPortalMeasurements(client.id, { id: project.id, name: project.name }, { days: seoDaysFor(days), hasLighthouse: latest.length > 0 }, db),
    history.listDailyPerformance(db, [project.id], from),
    readClientLogo(client.id, "full", db).then((l) => l ?? readClientLogo(client.id, "icon", db)).catch(() => null),
    latest[0] ? getAudit(latest[0].auditId, db).catch(() => null) : Promise.resolve(null),
  ]);

  // El detalle de ingeniería: lo que falla en las páginas más débiles, leído de lo guardado al terminar cada auditoría.
  let detail: ReportData["detail"] = [];
  if (kind === "engineering") {
    const keep = new Set(worstFirst(latest).map((l) => l.routeId).filter((id, i, all) => all.indexOf(id) === i).slice(0, ENGINEERING_DETAIL_ROUTES));
    const picked = worstFirst(latest).filter((l) => keep.has(l.routeId));
    const byAudit = await loadAuditImprovements(picked.map((l) => l.auditId), db);
    detail = picked.map((l) => ({ routeId: l.routeId, path: l.path, profile: l.profile, scores: l.scores, metrics: l.metrics, agentic: l.agentic, improvements: byAudit.get(l.auditId) ?? null }));
  }

  return {
    kind,
    generatedAt: now,
    days,
    from,
    clientName: project.clientName,
    contactName: client.contactName,
    contactEmail: client.contactEmail,
    projectId: project.id,
    projectName: project.name,
    baseUrl: project.baseUrl,
    performanceThreshold: thresholds.find((t) => t.metric === "performance" && t.enabled)?.minScore ?? null,
    latest,
    improvements: alerts.map((a) => ({
      routePath: a.routePath,
      profile: a.profile,
      text: a.kind === "audit_failure" ? "No se pudo auditar la página" : a.summary,
    })),
    charts,
    logo: logo ? { bytes: logo.bytes, bg: client.logoBg } : null,
    titles: Object.fromEntries(titles),
    pageImprovements,
    seo: measurements.traffic,
    fields: measurements.fields,
    states: measurements.states,
    daily: daily.map((d) => ({ day: d.day, value: d.value })),
    detail,
    lighthouseVersion: newest?.lighthouseVersion ?? null,
    thresholds: thresholds.filter((t) => t.enabled).map((t) => ({ metric: t.metric, minScore: t.minScore })),
  };
}

export function reportFilename(data: Pick<ReportData, "clientName" | "projectName" | "generatedAt" | "kind">): string {
  const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "informe";
  return `${REPORT_FILE_PREFIX[data.kind]}-${slug(data.clientName)}-${slug(data.projectName)}-${data.generatedAt.toISOString().slice(0, 10).replace(/-/g, "")}.pdf`;
}

