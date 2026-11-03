import { projectPath } from "@/lib/urls";
import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { alertStates } from "@/server/db/schema";
import {
  REMINDER_INTERVAL_MS,
  decideFailureOnFailure,
  decideFailureOnSuccess,
  decideThreshold,
  notifyKind,
} from "@/server/domain/alert-state-machine";
import { DomainError } from "@/server/domain/errors";
import type { Mailer } from "@/server/notify/mailer";
import { METRIC_TEXT } from "@/server/notify/labels";
import { buildDigestEmail, describeCondition, type DigestItem } from "@/server/notify/templates";
import { alertWhatsappMessage, buildWhatsappLink } from "@/server/notify/whatsapp-link";
import * as repo from "@/server/repositories/alerts";
import { findFirstAdmin } from "@/server/repositories/admin-users";
import * as audits from "@/server/repositories/audits";
import { findProject } from "@/server/repositories/projects";
import { findClient } from "@/server/repositories/clients";
import { assertUuid } from "./shared";
import type { Metric } from "./settings";

export type { OpenAlertRow, NotificationRow } from "@/server/repositories/alerts";

type Profile = "mobile" | "desktop";

const SCORE_FIELD = {
  performance: "scorePerformance",
  seo: "scoreSeo",
  accessibility: "scoreAccessibility",
  best_practices: "scoreBestPractices",
} as const satisfies Record<Metric, keyof audits.AuditLog>;

export type EvaluateResult = { opened: number; resolved: number };
const NOTHING: EvaluateResult = { opened: 0, resolved: 0 };

type Deps = { db?: Database; now?: () => Date };

/**
 * Evalúa una auditoría correcta de producción contra los umbrales del proyecto: abre las alertas
 * nuevas, deja en paz las que siguen igual y resuelve las que se recuperaron. También resuelve el
 * fallo de auditoría abierto de esa ruta y perfil. En desarrollo no hace nada.
 */
export async function evaluateAudit(auditId: string, deps: Deps = {}): Promise<EvaluateResult> {
  const db = deps.db ?? getDb();
  const now = (deps.now ?? (() => new Date()))();
  const ctx = await audits.findAuditContext(db, auditId);
  if (!ctx || ctx.audit.status !== "succeeded") return NOTHING;
  if (ctx.audit.phaseAtRun !== "production" || ctx.project.phase !== "production" || ctx.project.deletedAt) return NOTHING;

  const { audit, route, project } = ctx;
  const [thresholds, open] = await Promise.all([
    repo.listThresholds(db, project.id),
    repo.listOpenStatesForRoute(db, route.id, audit.profile),
  ]);

  const result = { opened: 0, resolved: 0 };
  await db.transaction(async (tx) => {
    for (const t of thresholds) {
      const score = audit[SCORE_FIELD[t.metric]];
      const current = open.find((s) => s.kind === "threshold" && s.metric === t.metric);
      const action = decideThreshold({ score, minScore: t.minScore, enabled: t.enabled, hasOpen: Boolean(current) });
      if (action === "open") {
        const rows = await tx
          .insert(alertStates)
          .values({
            projectId: project.id,
            routeId: route.id,
            profile: audit.profile,
            kind: "threshold",
            metric: t.metric,
            openedAt: now,
            openedByAuditId: audit.id,
            lastValue: score,
            thresholdAtOpen: t.minScore,
          })
          .onConflictDoNothing()
          .returning({ id: alertStates.id });
        result.opened += rows.length;
      } else if (action === "keep" && current) {
        await tx.update(alertStates).set({ lastValue: score }).where(eq(alertStates.id, current.id));
      } else if (action === "resolve" && current) {
        await tx
          .update(alertStates)
          .set({ status: "resolved", resolvedAt: now, resolvedByAuditId: audit.id, lastValue: score })
          .where(eq(alertStates.id, current.id));
        result.resolved += 1;
      }
    }
    const failure = open.find((s) => s.kind === "audit_failure");
    if (decideFailureOnSuccess(Boolean(failure)) === "resolve" && failure) {
      await tx
        .update(alertStates)
        .set({ status: "resolved", resolvedAt: now, resolvedByAuditId: audit.id })
        .where(eq(alertStates.id, failure.id));
      result.resolved += 1;
    }
  });
  return result;
}

/** Una auditoría de producción agotó sus reintentos: abre (o mantiene) el fallo de esa ruta y perfil. */
export async function evaluateFailure(auditId: string, deps: Deps = {}): Promise<EvaluateResult> {
  const db = deps.db ?? getDb();
  const now = (deps.now ?? (() => new Date()))();
  const ctx = await audits.findAuditContext(db, auditId);
  if (!ctx || ctx.audit.status !== "failed") return NOTHING;
  if (ctx.audit.phaseAtRun !== "production" || ctx.project.phase !== "production" || ctx.project.deletedAt) return NOTHING;

  const { audit, route, project } = ctx;
  const open = (await repo.listOpenStatesForRoute(db, route.id, audit.profile)).find((s) => s.kind === "audit_failure");
  if (decideFailureOnFailure(Boolean(open)) === "open") {
    const rows = await db
      .insert(alertStates)
      .values({
        projectId: project.id,
        routeId: route.id,
        profile: audit.profile,
        kind: "audit_failure",
        metric: null,
        openedAt: now,
        openedByAuditId: audit.id,
      })
      .onConflictDoNothing()
      .returning({ id: alertStates.id });
    return { opened: rows.length, resolved: 0 };
  }
  return NOTHING;
}

// ------------------------------------------------------------------ envío

export type SweepConfig = {
  db?: Database;
  /** null/undefined = SMTP sin configurar: se evalúa pero no se envía. */
  mailer: Mailer | null | undefined;
  /** A quién se avisa. */
  recipient: string;
  /** URL pública del web, para los enlaces del correo. */
  appUrl: string;
  now?: () => Date;
  reminderIntervalMs?: number;
  /** Espera tras un envío fallido antes de reintentar ese proyecto. */
  retryAfterMs?: number;
  /** Las auditorías en cola más antiguas que esto no retrasan el correo (se consideran atascadas). */
  pendingWindowMs?: number;
  log?: { info(o: object, m: string): void; warn(o: object, m: string): void };
};

export type SweepResult = { sent: number; failed: number; waiting: number; skipped: number };

/** Texto corto y seguro del error de envío para la bitácora. */
function safeError(err: unknown): string {
  const e = err as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof e?.code === "string" ? e.code : null;
  const resp = typeof e?.responseCode === "number" ? ` ${e.responseCode}` : "";
  const msg = typeof e?.message === "string" ? e.message.replace(/\s+/g, " ").slice(0, 160) : "error desconocido";
  return `${code ? `${code}${resp}: ` : ""}${msg}`;
}

/**
 * Avisa por correo, agrupando por proyecto, de las alertas nuevas y de las que siguen abiertas
 * hace 7 días o más. El correo de un proyecto espera a que terminen sus auditorías pendientes,
 * para que una corrida con varias métricas caídas produzca un solo mensaje.
 */
export async function sweepNotifications(config: SweepConfig): Promise<SweepResult> {
  const db = config.db ?? getDb();
  const now = (config.now ?? (() => new Date()))();
  const interval = config.reminderIntervalMs ?? REMINDER_INTERVAL_MS;
  const result: SweepResult = { sent: 0, failed: 0, waiting: 0, skipped: 0 };

  const rows = (await repo.listOpenAlerts(db))
    .map((r) => ({ ...r, due: notifyKind(r.state, now, interval) }))
    .filter((r): r is typeof r & { due: "new" | "reminder" } => r.due !== null);
  if (rows.length === 0) return result;
  if (!config.mailer) {
    result.skipped = rows.length;
    config.log?.warn({ pending: rows.length }, "hay alertas por avisar pero SMTP no está configurado en este servicio");
    return result;
  }

  const byProject = new Map<string, typeof rows>();
  for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  const ids = [...byProject.keys()];
  const [busy, recentlyFailed] = await Promise.all([
    repo.projectsWithPendingAudits(db, ids, new Date(now.getTime() - (config.pendingWindowMs ?? 3 * 3_600_000))),
    repo.projectsWithRecentFailedNotification(db, ids, new Date(now.getTime() - (config.retryAfterMs ?? 3_600_000))),
  ]);

  const base = config.appUrl.replace(/\/+$/, "");
  for (const [projectId, group] of byProject) {
    if (busy.has(projectId)) {
      result.waiting += group.length;
      continue;
    }
    if (recentlyFailed.has(projectId)) {
      result.skipped += group.length;
      continue;
    }
    const first = group[0]!;
    const items: DigestItem[] = group.map((r) => ({
      kind: r.state.kind,
      status: r.due === "new" ? "new" : "reminder",
      routePath: r.routePath,
      profile: r.state.profile,
      metric: r.state.metric,
      value: r.state.lastValue,
      threshold: r.state.thresholdAtOpen,
      errorCode: r.errorCode,
      openedAt: r.state.openedAt,
      reminderCount: r.state.reminderCount,
      auditId: r.state.openedByAuditId,
    }));
    const mail = buildDigestEmail({
      projectName: first.projectName,
      clientName: first.clientName,
      projectUrl: `${base}${projectPath(first.clientSlug, first.projectSlug)}`,
      auditsBase: `${base}/admin/auditorias`,
      items,
      now,
    });
    const stateIds = group.map((r) => r.state.id);
    try {
      await config.mailer.send({ to: config.recipient, subject: mail.subject, text: mail.text, html: mail.html });
    } catch (err) {
      result.failed += group.length;
      await repo.insertNotification(db, {
        projectId,
        clientId: first.clientId,
        type: mail.type,
        recipient: config.recipient,
        subject: mail.subject,
        alertStateIds: stateIds,
        status: "failed",
        error: safeError(err),
        sentAt: now,
      });
      config.log?.warn({ projectId, err: safeError(err) }, "no se pudo enviar el correo de alertas");
      continue;
    }
    await db.transaction(async (tx) => {
      await repo.insertNotification(tx as unknown as Database, {
        projectId,
        clientId: first.clientId,
        type: mail.type,
        recipient: config.recipient,
        subject: mail.subject,
        alertStateIds: stateIds,
        status: "sent",
        sentAt: now,
      });
      await repo.markNotified(tx as unknown as Database, stateIds, now);
    });
    result.sent += group.length;
    config.log?.info({ projectId, type: mail.type, alerts: group.length }, "correo de alertas enviado");
  }
  return result;
}

/** ALERT_EMAIL si está definido; si no, el correo del administrador. null si no hay ninguno. */
export async function resolveAlertRecipient(alertEmail: string | undefined, db: Database = getDb()): Promise<string | null> {
  if (alertEmail) return alertEmail;
  return (await findFirstAdmin(db))?.email ?? null;
}

// ------------------------------------------------------------------ lectura (UI)

export type AlertView = {
  id: string;
  kind: "threshold" | "audit_failure";
  routePath: string;
  profile: Profile;
  /** Texto corto: "SEO 69 (mínimo 90)" o "la auditoría falla". */
  summary: string;
  openedAt: Date;
  lastNotifiedAt: Date | null;
  reminderCount: number;
  auditId: string | null;
  projectId: string;
  projectName: string;
  projectSlug: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
};

function toView(r: repo.OpenAlertRow): AlertView {
  const s = r.state;
  const summary = describeCondition({
    kind: s.kind,
    status: "new",
    routePath: r.routePath,
    profile: s.profile,
    metric: s.metric,
    value: s.lastValue,
    threshold: s.thresholdAtOpen,
    errorCode: r.errorCode,
    openedAt: s.openedAt,
    reminderCount: s.reminderCount,
    auditId: s.openedByAuditId,
  });
  return {
    id: s.id,
    kind: s.kind,
    routePath: r.routePath,
    profile: s.profile,
    summary,
    openedAt: s.openedAt,
    lastNotifiedAt: s.lastNotifiedAt,
    reminderCount: s.reminderCount,
    auditId: s.openedByAuditId,
    projectId: r.projectId,
    projectName: r.projectName,
    projectSlug: r.projectSlug,
    clientId: r.clientId,
    clientName: r.clientName,
    clientSlug: r.clientSlug,
  };
}

export async function listOpenAlerts(projectId?: string, db: Database = getDb()): Promise<AlertView[]> {
  if (projectId) assertUuid(projectId, "Proyecto");
  return (await repo.listOpenAlerts(db, { projectId })).map(toView);
}

export function listRecentNotifications(limit = 20, projectId?: string, db: Database = getDb()) {
  if (projectId) assertUuid(projectId, "Proyecto");
  return repo.listRecentNotifications(db, Math.min(Math.max(limit, 1), 100), projectId);
}

/** Enlace de WhatsApp para avisar al cliente de las alertas abiertas del proyecto. null si no hay teléfono o alertas. */
export async function getWhatsappLinkForProject(projectId: string, db: Database = getDb()): Promise<string | null> {
  assertUuid(projectId, "Proyecto");
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const client = await findClient(db, project.clientId);
  if (!client) return null;
  const alerts = await repo.listOpenAlerts(db, { projectId });
  if (alerts.length === 0) return null;
  const message = alertWhatsappMessage({
    contactName: client.contactName,
    projectName: project.name,
    total: alerts.length,
    alerts: alerts.map((a) => {
      const s = a.state;
      const label =
        s.kind === "audit_failure"
          ? `no pudimos auditar la página (${s.profile === "mobile" ? "móvil" : "escritorio"})`
          : `${METRIC_TEXT[s.metric!]} ${s.lastValue ?? "—"}/100 (${s.profile === "mobile" ? "móvil" : "escritorio"})`;
      return { routePath: a.routePath, label };
    }),
  });
  return buildWhatsappLink(client.contactPhone, message);
}

