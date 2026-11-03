import { getDb, type Database } from "@/server/db/client";
import { env } from "@/server/config/env";
import { DomainError } from "@/server/domain/errors";
import type { Period } from "@/server/domain/history";
import { createMailer, type Mailer } from "@/server/notify/mailer";
import { buildReportEmail } from "@/server/notify/report-email";
import { getProjectReportPdf } from "@/server/report";
import { insertNotification, listRecentNotifications } from "@/server/repositories/alerts";
import { getClient } from "./clients";
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

function defaultMailer(): Mailer {
  const e = env();
  return createMailer({ host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER || undefined, pass: e.SMTP_PASS || undefined, from: e.EMAIL_FROM });
}

/** Envía por correo al contacto del cliente el informe PDF del proyecto y lo deja en la bitácora. */
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
  const { filename, pdf } = await (deps.getPdf ?? getProjectReportPdf)(projectId, days, db);
  const mail = buildReportEmail({
    contactName: client.contactName,
    projectName: project.name,
    days,
    portalUrl: `${base}${portalProjectPath(client.magicToken, project.slug)}`,
  });
  const record = { projectId, clientId: client.id, type: "report" as const, recipient: to, subject: mail.subject, sentAt: now };
  try {
    await (deps.mailer ?? defaultMailer()).send({
      to,
      ...mail,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
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
