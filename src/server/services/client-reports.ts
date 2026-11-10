import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import { senderMailFields, type ClientSender } from "@/server/domain/client-sender";
import { ccAddresses, greetingNames, siteLabel } from "@/server/domain/client-welcome";
import {
  buildPartitionRows,
  buildSourceRows,
  lastFullMonth,
  lastFullWeek,
  monthlyStatus,
  monthlyWindowOpen,
  pointsDelta,
  roundedAvg,
  shortDay,
  weeklySummary,
  weeklyWindowOpen,
  type MonthPeriod,
  type SourceRow,
  type WeekPeriod,
} from "@/server/domain/client-reports";
import { FIELD_LABEL, assess, formatField, rate } from "@/server/domain/field-data";
import { percentChange } from "@/server/domain/seo-data";
import {
  buildMonthlyEmail,
  buildWeeklyEmail,
  type ClientEmail,
  type ClientEmailBase,
  type MonthlyInput,
  type WeeklyInput,
} from "@/server/notify/client-emails";
import type { Mailer } from "@/server/notify/mailer";
import { webMailer } from "@/server/notify/web-mailer";
import { insertNotification } from "@/server/repositories/alerts";
import * as repo from "@/server/repositories/client-reports";
import type { ReportKind } from "@/server/repositories/client-reports";
import { findClient, type Client } from "@/server/repositories/clients";
import { findProject, type Project } from "@/server/repositories/projects";
import * as seoData from "@/server/repositories/seo-data";
import * as seoIntegrations from "@/server/repositories/seo-integrations";
import { portalProjectPath } from "@/lib/urls";
import { findFieldData } from "./crux";
import { resolveSender } from "./client-sender";
import { assertUuid } from "./shared";

export type ReportDeps = {
  mailer?: Mailer;
  appUrl?: string;
  now?: () => Date;
};

type Prepared<T> = { ok: true; input: T } | { ok: false; reason: string };

const TOP_SOURCES = 40;
const pageLabel = (page: string) => (page === "/" ? "Inicio" : page);

type Ctx = { project: Project; client: Client; now: Date; base: string; emailBase: ClientEmailBase };

function contextOf(project: Project, client: Client, now: Date, deps: ReportDeps, sender: ClientSender): Ctx {
  const base = (deps.appUrl ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return {
    project,
    client,
    now,
    base,
    emailBase: {
      names: greetingNames(client.contactName, client.ccContacts),
      clientName: client.name,
      site: siteLabel(project.baseUrl),
        portalUrl: `${base}${portalProjectPath(client.slug, project.slug)}`,
      sender,
      appUrl: base,
    },
  };
}

/**
 * Los orígenes de las visitas de un periodo: el reparto completo (`seo_source_daily`) si cubre las visitas del periodo; si no
 * (antes de la primera descarga completa), los canales de GA4 con las redes por separado.
 */
async function sourceRowsFor(db: Database, projectId: string, cur: { from: string; to: string }, prev: { from: string; to: string }, sessions: number): Promise<SourceRow[]> {
  const [items, prevItems] = await Promise.all([seoData.sourceTop(db, projectId, cur, TOP_SOURCES), seoData.sourceTop(db, projectId, prev, TOP_SOURCES)]);
  const covered = items.reduce((n, r) => n + r.sessions, 0);
  return items.length > 0 && covered >= sessions * 0.95 ? buildPartitionRows(items, prevItems) : legacyRows(db, projectId, cur, prev);
}

/** Los orígenes a partir de los canales de GA4 y las redes (solo mientras no exista el reparto completo). */
async function legacyRows(db: Database, projectId: string, cur: { from: string; to: string }, prev: { from: string; to: string }): Promise<SourceRow[]> {
  const [channels, prevChannels, networks, prevNetworks] = await Promise.all([
    seoData.trafficBy(db, projectId, cur, "channel", TOP_SOURCES),
    seoData.trafficBy(db, projectId, prev, "channel", TOP_SOURCES),
    seoData.socialBy(db, projectId, cur, "network", TOP_SOURCES),
    seoData.socialBy(db, projectId, prev, "network", TOP_SOURCES),
  ]);
  return buildSourceRows({
    channels: channels.map((r) => ({ key: r.key, sessions: r.sessions })),
    prevChannels: prevChannels.map((r) => ({ key: r.key, sessions: r.sessions })),
    networks: networks.map((r) => ({ key: r.key, sessions: r.sessions })),
    prevNetworks: prevNetworks.map((r) => ({ key: r.key, sessions: r.sessions })),
  });
}

// ---------------------------------------------------------------- semanal

/** Arma «Tu semana en la web» con lo guardado de GA4 y Search Console. Nunca con una semana a medias. */
export async function prepareWeekly(c: Ctx, week: WeekPeriod, db: Database): Promise<Prepared<WeeklyInput>> {
  const ga4 = await seoIntegrations.findOne(db, c.project.id, "ga4");
  if (!ga4?.syncedThrough) return { ok: false, reason: "GA4 no está conectado o todavía no descargó datos." };
  if (!c.project.seoClientVisible) return { ok: false, reason: "El tráfico no está visible para el cliente (actívalo en la pestaña SEO del proyecto)." };
  if (ga4.syncedThrough < week.to) return { ok: false, reason: `Los datos de GA4 llegan hasta el ${ga4.syncedThrough} y la semana termina el ${week.to}.` };

  const cur = { from: week.from, to: week.to };
  const prev = { from: week.prevFrom, to: week.prevTo };
  const [now, before] = await Promise.all([seoData.trafficTotals(db, c.project.id, cur), seoData.trafficTotals(db, c.project.id, prev)]);
  if (now.rows === 0) return { ok: false, reason: "No hay datos de tráfico de esa semana." };

  const [rows, pages, search, prevSearch, ai, prevAi, queries] = await Promise.all([
    sourceRowsFor(db, c.project.id, cur, prev, now.sessions),
    seoData.trafficBy(db, c.project.id, cur, "page", 3),
    seoData.searchTotals(db, c.project.id, cur),
    seoData.searchTotals(db, c.project.id, prev),
    seoData.aiTotals(db, c.project.id, cur),
    seoData.aiTotals(db, c.project.id, prev),
    seoData.queryTop(db, c.project.id, cur, 3),
  ]);
  const visitsDeltaPct = percentChange(now.sessions, before.sessions);
  return {
    ok: true,
    input: {
      ...c.emailBase,
      rangeLabel: week.label,
      rangeShort: week.short,
      visits: now.sessions,
      visitsDeltaPct,
      search: search.rows > 0 ? { clicks: search.clicks, clicksDeltaPct: percentChange(search.clicks, prevSearch.clicks), impressions: search.impressions } : null,
      sources: rows,
      ai: ai.sessions > 0 ? { visits: ai.sessions, deltaPct: percentChange(ai.sessions, prevAi.sessions) } : null,
      queries: queries.map((q) => ({ query: q.query, clicks: q.clicks })),
      topPages: pages.map((p) => ({ label: pageLabel(p.key), visits: p.sessions })),
      summaryLine: weeklySummary({ visits: now.sessions, visitsDeltaPct, rows }),
      dataThrough: week.endShort,
    },
  };
}

// ---------------------------------------------------------------- mensual

/** Las visitas del mes y de dónde llegaron; solo con el tráfico visible para el cliente y el mes completo descargado. */
async function monthlyTraffic(c: Ctx, month: MonthPeriod, db: Database): Promise<NonNullable<MonthlyInput["traffic"]> | null> {
  if (!c.project.seoClientVisible) return null;
  const ga4 = await seoIntegrations.findOne(db, c.project.id, "ga4");
  if (!ga4?.syncedThrough || ga4.syncedThrough < month.to) return null;
  const cur = { from: month.from, to: month.to };
  const prev = { from: month.prevFrom, to: month.prevTo };
  const [now, before] = await Promise.all([seoData.trafficTotals(db, c.project.id, cur), seoData.trafficTotals(db, c.project.id, prev)]);
  if (now.rows === 0) return null;
  const rows = await sourceRowsFor(db, c.project.id, cur, prev, now.sessions);
  return { visits: now.sessions, deltaPct: percentChange(now.sessions, before.sessions), sources: rows.slice(0, 5) };
}

/** Clics, impresiones, posición y las búsquedas principales del mes (Search Console), si el mes está completo. */
async function monthlySearch(c: Ctx, month: MonthPeriod, db: Database): Promise<NonNullable<MonthlyInput["search"]> | null> {
  if (!c.project.seoClientVisible) return null;
  const gsc = await seoIntegrations.findOne(db, c.project.id, "gsc");
  if (!gsc?.syncedThrough || gsc.syncedThrough < month.to) return null;
  const cur = { from: month.from, to: month.to };
  const [now, before, queries] = await Promise.all([
    seoData.searchTotals(db, c.project.id, cur),
    seoData.searchTotals(db, c.project.id, { from: month.prevFrom, to: month.prevTo }),
    seoData.queryTop(db, c.project.id, cur, 3),
  ]);
  if (now.rows === 0) return null;
  return {
    clicks: now.clicks,
    clicksDeltaPct: percentChange(now.clicks, before.clicks),
    impressions: now.impressions,
    position: now.impressions > 0 ? Math.round((now.positionSum / now.impressions) * 10) / 10 : null,
    queries: queries.map((q) => ({ query: q.query, clicks: q.clicks })),
  };
}

const RATING_WORD = { good: "bueno", "needs-improvement": "mejorable", poor: "deficiente" } as const;

/** La experiencia real de los visitantes (Chrome UX Report, móvil): veredicto y LCP, INP y CLS. No depende de Google Analytics. */
async function monthlyField(projectId: string, db: Database): Promise<NonNullable<MonthlyInput["field"]> | null> {
  const view = await findFieldData(projectId, "origin", "mobile", db);
  if (view?.status !== "ok" || !view.metrics) return null;
  const verdict = assess(view.metrics);
  if (verdict === "no-data") return null;
  const items = (["lcp", "inp", "cls"] as const).flatMap((m) => {
    const p75 = view.metrics?.[m]?.p75 ?? null;
    const rating = rate(m, p75);
    return rating ? [{ label: FIELD_LABEL[m].split(" ")[0]!, value: formatField(m, p75), word: RATING_WORD[rating] }] : [];
  });
  return { verdict, items };
}

/** Arma «Estado general» con las auditorías del mes, el registro de actuaciones y la revisión del servidor. */
export async function prepareMonthly(c: Ctx, month: MonthPeriod, db: Database): Promise<Prepared<MonthlyInput>> {
  const cur = { from: month.from, to: month.to };
  const [now, before] = await Promise.all([repo.monthScores(db, c.project.id, cur), repo.monthScores(db, c.project.id, { from: month.prevFrom, to: month.prevTo })]);
  if (now.mobile.audits + now.desktop.audits === 0) return { ok: false, reason: `No hubo auditorías en producción en ${month.label}.` };

  const fields = [
    { label: "Rendimiento", f: "performance" },
    { label: "Visibilidad (SEO)", f: "seo" },
    { label: "Accesibilidad", f: "accessibility" },
  ] as const;
  const scores = fields.flatMap(({ label, f }) => {
    const mobile = roundedAvg([now.mobile[f]]);
    const desktop = roundedAvg([now.desktop[f]]);
    if (mobile === null || desktop === null) return [];
    return [{ label, mobile, desktop, mobileDelta: pointsDelta(mobile, roundedAvg([before.mobile[f]])), desktopDelta: pointsDelta(desktop, roundedAvg([before.desktop[f]])) }];
  });
  if (scores.length === 0) return { ok: false, reason: "Faltan auditorías de móvil o de escritorio en el mes." };

  const [openAlerts, actions, newPages, checked] = await Promise.all([
    repo.countOpenAlerts(db, c.project.id),
    repo.listActionsBetween(db, c.project.id, cur),
    repo.countNewMonitoredRoutes(db, c.project.id, cur),
    c.project.services.includes("server") ? repo.hasServerCheck(db, c.project.id, month.key) : Promise.resolve(false),
  ]);
  const status = monthlyStatus({ openAlerts, mobilePerfDelta: scores[0]?.mobileDelta ?? null, actions: actions.length });
  const [traffic, search, field] = await Promise.all([monthlyTraffic(c, month, db), monthlySearch(c, month, db), monthlyField(c.project.id, db)]);
  return {
    ok: true,
    input: {
      ...c.emailBase,
      monthLabel: month.label,
      prevMonthLabel: month.prevLabel,
      tone: status.tone,
      statusLine: status.line,
      scores,
      serverConfirmed: checked,
      initialImprovement: c.project.initialImprovement,
      actions: actions.map((a) => ({ date: shortDay(a.happenedOn), text: a.text })),
      upcoming: null,
      traffic,
      search,
      field,
      newPages: newPages > 0 ? `${newPages} ${newPages === 1 ? "página nueva" : "páginas nuevas"} en ${month.label}, ya en seguimiento automático.` : null,
      reportUrl: `${c.emailBase.portalUrl}/informe?tipo=resumen&dias=30`,
      engineeringUrl: `${c.emailBase.portalUrl}/informe?tipo=ingenieria&dias=30`,
    },
  };
}

// ------------------------------------------------------------------ envío

export type SendOutcome =
  | { status: "sent"; to: string; cc: string[]; periodKey: string; test: boolean }
  | { status: "skipped"; reason: string; periodKey: string };

function periodOf(kind: ReportKind, now: Date): { key: string; week?: WeekPeriod; month?: MonthPeriod } {
  if (kind === "weekly") {
    const week = lastFullWeek(now);
    return { key: week.key, week };
  }
  const month = lastFullMonth(now);
  return { key: month.key, month };
}

/**
 * Envía el correo semanal o mensual de un proyecto con los datos reales del último periodo completo. Con `testTo` es una
 * prueba: va solo a esa dirección y no deja rastro ni cuenta como el envío del periodo. Si falta algo (datos
 * incompletos, GA4 sin conectar…) el envío automático lo anota como «omitido» con el motivo, y la prueba lo explica.
 */
export async function sendClientReport(kind: ReportKind, projectId: string, opts: { testTo?: string } = {}, db: Database = getDb(), deps: ReportDeps = {}): Promise<SendOutcome> {
  assertUuid(projectId, "Proyecto");
  const now = (deps.now ?? (() => new Date()))();
  const test = Boolean(opts.testTo);
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const client = await findClient(db, project.clientId);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  const primary = client.contactEmail?.trim();
  if (!test) {
    if (!primary) throw new DomainError("INVALID", "Este cliente no tiene correo de contacto.");
    if (client.status !== "active") throw new DomainError("INVALID", "El cliente está suspendido.");
  }
  if (project.phase !== "production") throw new DomainError("INVALID", "El proyecto debe estar en producción.");

  const period = periodOf(kind, now);
  const sender = await resolveSender(db, client);
  const ctx = contextOf(project, client, now, deps, sender);
  const skip = async (reason: string): Promise<SendOutcome> => {
    if (test) throw new DomainError("INVALID", reason);
    await repo.recordSend(db, { projectId, kind, periodKey: period.key, status: "skipped", detail: reason, at: now });
    return { status: "skipped", reason, periodKey: period.key };
  };

  let mail: ClientEmail;
  if (kind === "weekly") {
    const prepared = await prepareWeekly(ctx, period.week!, db);
    if (!prepared.ok) return skip(prepared.reason);
    mail = buildWeeklyEmail(prepared.input);
  } else {
    const prepared = await prepareMonthly(ctx, period.month!, db);
    if (!prepared.ok) return skip(prepared.reason);
    mail = buildMonthlyEmail(prepared.input);
  }

  const to = test ? opts.testTo! : primary!;
  const cc = test ? [] : ccAddresses(client.ccContacts, primary);
  const subject = test ? `[PRUEBA] ${mail.subject}` : mail.subject;
  try {
    await (deps.mailer ?? webMailer()).send({ to, ...(cc.length > 0 ? { cc } : {}), ...mail, subject, ...senderMailFields(sender) });
  } catch (err) {
    if (!test) {
      const e = err as { code?: unknown; message?: unknown };
      const detail = `${typeof e?.code === "string" ? `${e.code}: ` : ""}${typeof e?.message === "string" ? e.message.replace(/\s+/g, " ").slice(0, 160) : "error desconocido"}`;
      await repo.recordSend(db, { projectId, kind, periodKey: period.key, status: "failed", detail, at: now });
      await insertNotification(db, { projectId, clientId: client.id, type: kind, recipient: [to, ...cc].join(", "), subject, status: "failed", error: detail, sentAt: now });
    }
    throw new DomainError("UPSTREAM", "No se pudo enviar el correo. Revisa la configuración SMTP e inténtalo de nuevo.");
  }
  if (!test) {
    await repo.recordSend(db, { projectId, kind, periodKey: period.key, status: "sent", at: now });
    await insertNotification(db, { projectId, clientId: client.id, type: kind, recipient: [to, ...cc].join(", "), subject, status: "sent", sentAt: now });
  }
  return { status: "sent", to, cc, periodKey: period.key, test };
}

// ------------------------------------------------------------- automático

export type RunSummary = { sent: number; skipped: number; failed: number; already: number };
type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

/**
 * El trabajo diario del worker: para cada proyecto en producción de un cliente con el correo semanal o mensual encendido,
 * envía el del periodo si estamos en su ventana y todavía no salió. Lo que ya se envió no se repite; lo omitido (datos
 * incompletos) o fallido se reintenta al día siguiente mientras la ventana siga abierta.
 */
export async function runClientReports(db: Database, deps: ReportDeps = {}, log?: Log): Promise<RunSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const summary: RunSummary = { sent: 0, skipped: 0, failed: 0, already: 0 };
  const kinds: ReportKind[] = [...(weeklyWindowOpen(now) ? (["weekly"] as const) : []), ...(monthlyWindowOpen(now) ? (["monthly"] as const) : [])];
  if (kinds.length === 0) return summary;
  const candidates = await repo.listReportCandidates(db);
  for (const { project, client } of candidates) {
    for (const kind of kinds) {
      if (kind === "weekly" ? !client.reportWeekly : !client.reportMonthly) continue;
      const key = periodOf(kind, now).key;
      const existing = await repo.findSend(db, project.id, kind, key);
      if (existing?.status === "sent") {
        summary.already++;
        continue;
      }
      try {
        const r = await sendClientReport(kind, project.id, {}, db, deps);
        if (r.status === "sent") summary.sent++;
        else {
          summary.skipped++;
          log?.info({ projectId: project.id, kind, key, reason: r.reason }, "correo automático omitido");
        }
      } catch (err) {
        summary.failed++;
        log?.error({ projectId: project.id, kind, key, err: err instanceof Error ? err.message : String(err) }, "correo automático fallido");
      }
    }
  }
  return summary;
}

// ------------------------------------------------- preferencias y registro (panel)

const todayOf = (now: Date) => now.toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Enciende o apaga los correos automáticos de un cliente. Por defecto están apagados. */
export async function setReportPreferences(clientId: string, flags: { weekly: boolean; monthly: boolean }, db: Database = getDb()): Promise<void> {
  assertUuid(clientId, "Cliente");
  const client = await findClient(db, clientId);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  await repo.setClientReportFlags(db, clientId, { reportWeekly: flags.weekly, reportMonthly: flags.monthly });
}

/** Anota algo que se hizo en el proyecto: sale en «Lo que atendimos» del correo del mes en que ocurrió. */
export async function addProjectAction(projectId: string, input: { date?: string; text: string }, db: Database = getDb(), now: () => Date = () => new Date()): Promise<void> {
  assertUuid(projectId, "Proyecto");
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const text = (input.text ?? "").trim().replace(/\s+/g, " ");
  if (text.length < 3) throw new DomainError("INVALID", "Cuenta qué hiciste (al menos 3 caracteres).");
  if (text.length > 240) throw new DomainError("INVALID", "Máximo 240 caracteres: el cliente lo lee en su correo.");
  const today = todayOf(now());
  const date = (input.date ?? "").trim() || today;
  if (!ISO_DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new DomainError("INVALID", "La fecha no es válida.");
  if (date > today) throw new DomainError("INVALID", "La fecha no puede ser futura.");
  await repo.insertAction(db, { projectId, happenedOn: date, text });
}

export async function removeProjectAction(projectId: string, actionId: string, db: Database = getDb()): Promise<void> {
  assertUuid(projectId, "Proyecto");
  assertUuid(actionId, "Actuación");
  if (!(await repo.deleteAction(db, projectId, actionId))) throw new DomainError("NOT_FOUND", "Actuación no encontrada.");
}

/** «Revisé el servidor este mes»: solo así el correo mensual lo afirma. Admite el mes en curso y el anterior. */
export async function confirmServerCheck(projectId: string, month: string, db: Database = getDb(), now: () => Date = () => new Date()): Promise<void> {
  assertUuid(projectId, "Proyecto");
  const current = todayOf(now()).slice(0, 7);
  const previous = lastFullMonth(now()).key;
  if (month !== current && month !== previous) throw new DomainError("INVALID", "Solo puedes confirmar el mes en curso o el anterior.");
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  await repo.setServerCheck(db, projectId, month, now());
}

export type EmailsPanel = {
  weekly: boolean;
  monthly: boolean;
  actions: Awaited<ReturnType<typeof repo.listRecentActions>>;
  sends: Awaited<ReturnType<typeof repo.listSends>>;
  checkedMonths: string[];
  months: { current: string; previous: string };
};

/** Lo que muestra la tarjeta «Correos al cliente» de un proyecto. */
export async function getEmailsPanel(projectId: string, db: Database = getDb(), now: () => Date = () => new Date()): Promise<EmailsPanel> {
  assertUuid(projectId, "Proyecto");
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const client = await findClient(db, project.clientId);
  const [actions, sends, checkedMonths] = await Promise.all([repo.listRecentActions(db, projectId, 12), repo.listSends(db, projectId, 8), repo.listServerChecks(db, projectId, 6)]);
  return {
    weekly: Boolean(client?.reportWeekly),
    monthly: Boolean(client?.reportMonthly),
    actions,
    sends,
    checkedMonths,
    months: { current: todayOf(now()).slice(0, 7), previous: lastFullMonth(now()).key },
  };
}
