import { getDb, type Database } from "@/server/db/client";
import { SEO_CLIENT_GROUPS, SEO_CLIENT_TITLE } from "@/server/domain/seo-client-glossary";
import { ISSUE_CATALOG, ISSUE_CODES, SITE, diffIssues, summarize, type Evidence, type IssueCode, type IssueGroup } from "@/server/domain/seo-crawl-rules";
import * as crawl from "@/server/repositories/seo-crawl";
import * as repo from "@/server/repositories/seo-portal";
import { portalPageTitles } from "./portal";
import { getSeoDashboard, type SeoDashboard } from "./seo-data";
import { assertUuid } from "./shared";

/** Cuántas páginas afectadas se enseñan por hallazgo; el resto se resume con «y N más». */
const ROWS_PER_ISSUE = 8;

export type PortalHealthRow = { page: string; title: string; evidence: Evidence };
export type PortalHealthIssue = {
  code: IssueCode;
  severity: "error" | "warning";
  /** La frase llana del glosario. */
  text: string;
  /** Páginas afectadas (el hallazgo del sitio entero cuenta como una). */
  pages: number;
  /** Cuántas son nuevas frente a la revisión anterior. */
  added: number;
  rows: PortalHealthRow[];
  more: number;
};
export type PortalHealthGroup = { group: IssueGroup; label: string; hint: string; errors: number; warnings: number; issues: PortalHealthIssue[] };

/** La salud SEO del sitio para el cliente: el último rastreo terminado, solo errores y avisos, y su variación frente al anterior. */
export type PortalSeoHealth = {
  at: Date;
  pagesCrawled: number;
  /** El rastreo se cortó por límite de páginas o de tiempo: puede haber más páginas sin revisar. */
  truncated: boolean;
  errors: number;
  warnings: number;
  /** Nuevos y resueltos frente a la revisión anterior; null si es la primera. */
  changes: { added: number; resolved: number } | null;
  groups: PortalHealthGroup[];
};

export type PortalTraffic = {
  days: number;
  dashboard: SeoDashboard | null;
  health: PortalSeoHealth | null;
  /** El título de cada página que aparece en las listas (no su ruta). */
  titles: Record<string, string>;
};

async function loadHealth(project: { id: string; name: string }, db: Database): Promise<PortalSeoHealth | null> {
  const projectId = project.id;
  const [current, previous] = await crawl.listFinishedRuns(db, projectId, 2);
  if (!current) return null;
  const [now, before] = await Promise.all([crawl.listIssues(db, current.id), previous ? crawl.listIssues(db, previous.id) : Promise.resolve(null)]);
  // Información no se muestra al cliente: es lo que el administrador decide si atender.
  const visible = now.filter((i) => ISSUE_CATALOG[i.code as IssueCode]?.severity !== "info");
  const diff = before ? diffIssues(before.filter((i) => ISSUE_CATALOG[i.code as IssueCode]?.severity !== "info"), visible) : null;
  const added = new Set(diff?.added.map((i) => `${i.code}|${i.page}`) ?? []);
  const counts = summarize(visible);

  const titles = await portalPageTitles(project, [...new Set(visible.map((i) => i.page).filter((p) => p !== SITE))], db);
  const groups: PortalHealthGroup[] = [];
  for (const g of SEO_CLIENT_GROUPS) {
    const issues: PortalHealthIssue[] = [];
    for (const code of ISSUE_CODES.filter((c) => ISSUE_CATALOG[c].group === g.group && ISSUE_CATALOG[c].severity !== "info")) {
      const rows = visible.filter((i) => i.code === code);
      if (rows.length === 0) continue;
      issues.push({
        code,
        severity: ISSUE_CATALOG[code].severity as "error" | "warning",
        text: SEO_CLIENT_TITLE[code],
        pages: rows.length,
        added: rows.filter((i) => added.has(`${i.code}|${i.page}`)).length,
        rows: rows.slice(0, ROWS_PER_ISSUE).map((i) => ({ page: i.page, title: i.page === SITE ? "Todo el sitio" : (titles.get(i.page) ?? i.page), evidence: i.evidence })),
        more: Math.max(0, rows.length - ROWS_PER_ISSUE),
      });
    }
    if (issues.length === 0) continue;
    issues.sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error") || b.pages - a.pages);
    groups.push({ ...g, errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length, issues });
  }
  groups.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings);
  return {
    at: current.finishedAt ?? current.queuedAt,
    pagesCrawled: current.pagesCrawled,
    truncated: current.truncatedBy !== null,
    errors: counts.error,
    warnings: counts.warning,
    changes: diff ? { added: diff.added.length, resolved: diff.resolved.length } : null,
    groups,
  };
}

/**
 * Todo lo de la pestaña «Tráfico»: las visitas y la búsqueda (si hay Search Console o GA4 conectados) y la salud SEO del sitio
 * (si hay un rastreo). Una sola puerta: el proyecto debe ser del cliente, estar en producción y tener el SEO activado para él
 * (`seo_client_visible`); si no, null. La salud SEO no exige tener Google conectado.
 */
export async function getPortalTraffic(clientId: string, project: { id: string; name: string }, opts: { days: number }, db: Database = getDb()): Promise<PortalTraffic | null> {
  assertUuid(clientId, "Cliente");
  assertUuid(project.id, "Proyecto");
  if (!(await repo.findPortalSeoProject(db, clientId, project.id))) return null;
  const [dash, health] = await Promise.all([getSeoDashboard(project.id, { days: opts.days }, db), loadHealth(project, db)]);
  const dashboard = dash.sync.gsc || dash.sync.ga4 ? dash : null;
  if (!dashboard && !health) return null;
  const paths = new Set<string>();
  for (const p of dashboard?.traffic?.topPages ?? []) paths.add(p.page);
  for (const p of dashboard?.search?.topPages ?? []) paths.add(p.page);
  for (const p of dashboard?.ai?.topPages ?? []) paths.add(p.page);
  const titles = paths.size > 0 ? await portalPageTitles(project, [...paths], db) : new Map<string, string>();
  return { days: opts.days, dashboard, health, titles: Object.fromEntries(titles) };
}
