import { getDb, type Database } from "@/server/db/client";
import { metricValue, periodStart, type HistoryMetric, type Period } from "@/server/domain/history";
import * as history from "@/server/repositories/history";
import { listOpenAlerts } from "./alerts";
import { getClient } from "./clients";
import { getLatestScores, type LatestScores } from "./history";
import { getProject } from "./projects";
import { getThresholds } from "./thresholds";

type Profile = "mobile" | "desktop";
const OTHER_SCORES = ["seo", "accessibility", "best_practices"] as const satisfies readonly HistoryMetric[];
const MAX_CHARTS = 8;

export type RangeSummary = { metric: HistoryMetric; first: number; last: number; min: number; max: number };

export type ReportChart = {
  routePath: string;
  profile: Profile;
  points: Array<{ at: Date; value: number }>;
  ranges: RangeSummary[];
};

export type ReportData = {
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
};

/** Todo lo que el informe necesita, sin tocar ni PDF ni correo. El llamador valida el acceso al proyecto. */
export async function buildProjectReport(
  projectId: string,
  options: { days?: Period; now?: Date } = {},
  db: Database = getDb(),
): Promise<ReportData> {
  const days = options.days ?? 30;
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
  for (const l of latest.slice(0, MAX_CHARTS)) {
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

  return {
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
  };
}

export function reportFilename(data: Pick<ReportData, "clientName" | "projectName" | "generatedAt">): string {
  const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "informe";
  return `informe-${slug(data.clientName)}-${slug(data.projectName)}-${data.generatedAt.toISOString().slice(0, 10).replace(/-/g, "")}.pdf`;
}

