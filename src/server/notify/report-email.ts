import { EMAIL, emailBrandBand, emailButton } from "./email-theme";
import { PERIOD_LABEL, type Period } from "@/server/domain/history";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Correo que acompaña al informe PDF. Habla al cliente de "tú" y apunta a su portal. */
export function buildReportEmail(input: {
  contactName: string | null;
  projectName: string;
  days: Period;
  portalUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = input.contactName?.trim() ? `Hola ${input.contactName.trim()},` : "Hola,";
  const period = PERIOD_LABEL[input.days];
  const subject = `Informe de ${input.projectName}`;
  const line = `Te enviamos el informe de ${input.projectName} con las auditorías de los últimos ${period}. Lo encuentras adjunto en PDF.`;
  const portal = "También puedes ver siempre el estado actualizado en tu portal:";
  const text = [greeting, "", line, "", portal, input.portalUrl, "", "AOC PageSpeed"].join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:${EMAIL.ink};max-width:560px">` +
    emailBrandBand() +
    `<p style="margin:16px 0 0">${esc(greeting)}</p>` +
    `<p>${esc(line)}</p>` +
    `<p>${esc(portal)}</p>` +
    `<p style="margin:20px 0">${emailButton(esc(input.portalUrl), "Abrir mi portal")}</p>` +
    `</div>`;
  return { subject, text, html };
}
