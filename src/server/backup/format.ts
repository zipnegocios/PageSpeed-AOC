import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as s from "@/server/db/schema";

/**
 * Tablas que se respaldan, en un orden que respeta las claves foráneas al restaurar. `order` fija un
 * orden estable para paginar. Las tablas internas de Drizzle no entran: el esquema lo crean las migraciones.
 */
export const BACKUP_TABLES: ReadonlyArray<{ name: string; table: PgTable; order: PgTable["_"]["columns"][string][] }> = [
  { name: "clients", table: s.clients, order: [s.clients.id] },
  { name: "projects", table: s.projects, order: [s.projects.id] },
  { name: "routes", table: s.routes, order: [s.routes.id] },
  { name: "project_actions", table: s.projectActions, order: [s.projectActions.id] },
  { name: "server_checks", table: s.serverChecks, order: [s.serverChecks.projectId, s.serverChecks.month] },
  { name: "client_report_sends", table: s.clientReportSends, order: [s.clientReportSends.projectId, s.clientReportSends.kind, s.clientReportSends.periodKey] },
  { name: "seo_integrations", table: s.seoIntegrations, order: [s.seoIntegrations.id] },
  { name: "seo_markets", table: s.seoMarkets, order: [s.seoMarkets.projectId, s.seoMarkets.lang] },
  { name: "seo_crawl_runs", table: s.seoCrawlRuns, order: [s.seoCrawlRuns.id] },
  { name: "seo_crawl_pages", table: s.seoCrawlPages, order: [s.seoCrawlPages.runId, s.seoCrawlPages.path] },
  { name: "seo_crawl_issues", table: s.seoCrawlIssues, order: [s.seoCrawlIssues.runId, s.seoCrawlIssues.page, s.seoCrawlIssues.code] },
  { name: "seo_search_daily", table: s.seoSearchDaily, order: [s.seoSearchDaily.projectId, s.seoSearchDaily.date, s.seoSearchDaily.page, s.seoSearchDaily.country, s.seoSearchDaily.device] },
  { name: "seo_traffic_daily", table: s.seoTrafficDaily, order: [s.seoTrafficDaily.projectId, s.seoTrafficDaily.date, s.seoTrafficDaily.page, s.seoTrafficDaily.country, s.seoTrafficDaily.channel] },
  { name: "seo_ai_referrals_daily", table: s.seoAiReferralsDaily, order: [s.seoAiReferralsDaily.projectId, s.seoAiReferralsDaily.date, s.seoAiReferralsDaily.source, s.seoAiReferralsDaily.page] },
  { name: "seo_source_daily", table: s.seoSourceDaily, order: [s.seoSourceDaily.projectId, s.seoSourceDaily.date, s.seoSourceDaily.grp, s.seoSourceDaily.source, s.seoSourceDaily.page] },
  { name: "seo_query_daily", table: s.seoQueryDaily, order: [s.seoQueryDaily.projectId, s.seoQueryDaily.date, s.seoQueryDaily.query] },
  { name: "alert_thresholds", table: s.alertThresholds, order: [s.alertThresholds.projectId, s.alertThresholds.metric] },
  { name: "audit_logs", table: s.auditLogs, order: [s.auditLogs.id] },
  { name: "alert_states", table: s.alertStates, order: [s.alertStates.id] },
  { name: "notifications", table: s.notifications, order: [s.notifications.id] },
  { name: "mcp_api_keys", table: s.mcpApiKeys, order: [s.mcpApiKeys.id] },
  { name: "oauth_clients", table: s.oauthClients, order: [s.oauthClients.id] },
  { name: "admin_users", table: s.adminUsers, order: [s.adminUsers.id] },
  { name: "admin_invites", table: s.adminInvites, order: [s.adminInvites.id] },
  { name: "settings", table: s.settings, order: [s.settings.key] },
];

export const BACKUP_FORMAT = 1;

// Los nombres se leen del esquema: si una tabla cambia de nombre, esta lista no puede quedar desfasada.
for (const t of BACKUP_TABLES) {
  if (getTableName(t.table) !== t.name) throw new Error(`Tabla de respaldo desfasada: ${t.name}`);
}

/** Fechas y binarios no sobreviven a JSON: se marcan para recuperarlos tal cual. */
export function encodeRow(row: unknown): string {
  return JSON.stringify(row, function (this: Record<string, unknown>, key: string, value: unknown) {
    const raw = this[key];
    if (raw instanceof Date) return { $d: raw.toISOString() };
    if (Buffer.isBuffer(raw)) return { $b: raw.toString("base64") };
    return value;
  });
}

export function decodeRow<T = Record<string, unknown>>(line: string): T {
  return JSON.parse(line, (_k, v: unknown) => {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length === 1 && typeof o.$d === "string") return new Date(o.$d);
      if (keys.length === 1 && typeof o.$b === "string") return Buffer.from(o.$b, "base64");
    }
    return v;
  }) as T;
}

export type BackupHeader = { _: "pagespeed-backup"; format: number; createdAt: string; tables: string[] };
export type BackupFooter = { _: "end"; counts: Record<string, number> };
