import { getDb, type Database } from "@/server/db/client";
import { env } from "@/server/config/env";
import { senderMailFields } from "@/server/domain/client-sender";
import { ccAddresses, greetingNames, siteLabel } from "@/server/domain/client-welcome";
import { DomainError } from "@/server/domain/errors";
import { PERIOD_LABEL, type Period } from "@/server/domain/history";
import type { Mailer } from "@/server/notify/mailer";
import { webMailer } from "@/server/notify/web-mailer";
import { buildClientReportEmail } from "@/server/notify/client-emails";
import { getProjectReportPdf } from "@/server/report";
import { insertNotification, listRecentNotifications } from "@/server/repositories/alerts";
import { formatCount, formatPct } from "@/server/notify/client-emails";
import { percentChange } from "@/server/domain/seo-data";
import { listOpenAlerts } from "./alerts";
import { resolveSender } from "./client-sender";
import { getClient } from "./clients";
import { averageScores, getLatestScores } from "./history";
import { getPortalMeasurements } from "./project-measurements";
import { seoDaysFor } from "./report";
import { getProject } from "./projects";
import { portalProjectPath } from "@/lib/urls";

/** Mínimo entre dos envíos del informe del mismo proyecto, para no repetirlo por un doble clic. */
export const REPORT_COOLDOWN_MS = 5 * 60_000;

export type SendReportDeps = {
  mailer?: Mailer;
  appUrl?: string;
  now?: () => Date;
  /** Sustituible en pruebas para no renderizar un PDF real. */
  getPdf?: typeof getProjectReportPdf;
};

/** Envía por correo al contacto del cliente los dos informes en PDF del proyecto (resumen e ingeniería) y lo deja en la bitácora. */
export async function sendProjectReport(
  projectId: string,
  days: Period,
  db: Database = getDb(),
  deps: SendReportDeps = {},
): Promise<{ to: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const project = await getProject(projectId, db);
  const client = await getClient(project.clientId, db);
  const to = client.contactEmail?.trim();
  if (!to) throw new DomainError("INVALID", "Este cliente no tiene correo de contacto. Agrégalo en su ficha para poder enviarle el informe.");

  const recent = (await listRecentNotifications(db, 20, projectId)).find(
    (n) => n.type === "report" && n.status === "sent" && now.getTime() - n.sentAt.getTime() < REPORT_COOLDOWN_MS,
  );
  if (recent) throw new DomainError("CONFLICT", "El informe de este proyecto ya se envió hace unos minutos. Espera un poco antes de reenviarlo.");

  const base = (deps.appUrl ?? env().APP_URL).replace(/\/+$/, "");
  // Los dos informes, uno tras otro (el carril del PDF es serial y el web tiene poca memoria). Si uno falla no sale ninguno.
  const getPdf = deps.getPdf ?? getProjectReportPdf;
  const summary = await getPdf(projectId, days, "summary", db);
  const engineering = await getPdf(projectId, days, "engineering", db);
  const cc = ccAddresses(client.ccContacts, to);
  // Las cifras del correo salen de lo mismo que el portal y los PDF (con la misma puerta: tráfico solo si el cliente puede verlo).
  const [latest, alerts] = await Promise.all([getLatestScores(project.id, db), listOpenAlerts(project.id, db)]);
  const measurements = await getPortalMeasurements(client.id, { id: project.id, name: project.name }, { days: seoDaysFor(days), hasLighthouse: latest.length > 0 }, db);
  const facts: string[] = [];
  const perf = averageScores(latest).performance;
  if (perf !== null) facts.push(`**Velocidad:** rendimiento medio de tus páginas, ${Math.round(perf)} sobre 100.`);
  const d = measurements.traffic?.dashboard;
  if (d?.traffic) {
    const delta = percentChange(d.traffic.totals.sessions, d.traffic.previousTotals.sessions);
    const top = d.sources?.items.find((i) => i.group !== "direct");
    facts.push(`**Visitas:** ${formatCount(d.traffic.totals.sessions)}${delta === null ? "" : ` (${formatPct(delta)})`}${top ? `; el origen que más aporta: ${top.label}` : ""}.`);
  }
  if (d?.search) facts.push(`**Google:** ${formatCount(d.search.totals.clicks)} clics y ${formatCount(d.search.totals.impressions)} veces que apareció tu sitio.`);
  const sender = await resolveSender(db, client);
  const mail = buildClientReportEmail({
    sender,
    appUrl: base,
    names: greetingNames(client.contactName, client.ccContacts),
    clientName: client.name,
    site: siteLabel(project.baseUrl),
    portalUrl: `${base}${portalProjectPath(client.slug, project.slug)}`,
    periodLabel: days === 365 ? "último año" : `últimos ${PERIOD_LABEL[days]}`,
    summaryLine: alerts.length > 0 ? `Hay ${alerts.length} ${alerts.length === 1 ? "punto" : "puntos"} por mejorar; el detalle está en los informes.` : "Todo está dentro de la meta acordada.",
    facts,
  });
  const record = { projectId, clientId: client.id, type: "report" as const, recipient: [to, ...cc].join(", "), subject: mail.subject, sentAt: now };
  try {
    await (deps.mailer ?? webMailer()).send({
      to,
      ...(cc.length > 0 ? { cc } : {}),
      ...mail,
      ...senderMailFields(sender),
      attachments: [summary, engineering].map((f) => ({ filename: f.filename, content: f.pdf, contentType: "application/pdf" })),
    });
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    const detail = `${typeof e?.code === "string" ? `${e.code}: ` : ""}${typeof e?.message === "string" ? e.message.replace(/\s+/g, " ").slice(0, 160) : "error desconocido"}`;
    await insertNotification(db, { ...record, status: "failed", error: detail });
    throw new DomainError("UPSTREAM", "No se pudo enviar el correo. Revisa la configuración SMTP e inténtalo de nuevo.");
  }
  await insertNotification(db, { ...record, status: "sent" });
  return { to };
}
