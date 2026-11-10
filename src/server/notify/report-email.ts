import { EMAIL, EMAIL_TEXT_SIGNATURE, emailBrandBand, emailButton, emailFooter } from "./email-theme";
import { PERIOD_LABEL, type Period } from "@/server/domain/history";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Correo que acompaña a los dos informes PDF (resumen e ingeniería). Habla al cliente de "tú" y apunta a su portal. */
export function buildReportEmail(input: {
  contactName: string | null;
  projectName: string;
  days: Period;
  portalUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = input.contactName?.trim() ? `Hola ${input.contactName.trim()},` : "Hola,";
  const period = PERIOD_LABEL[input.days];
  const subject = `Informes técnicos web · ${input.projectName}`;
  const line = `Te enviamos los informes de ${input.projectName} con las auditorías de los últimos ${period}. Los encuentras adjuntos en PDF:`;
  const files = ["Informe resumen: el estado de tu sitio en pocas páginas, en lenguaje claro.", "Informe de ingeniería: el detalle técnico de cada página, medición por medición."];
  const portal = "También puedes ver siempre el estado actualizado en tu portal:";
  const text = [greeting, "", line, ...files.map((f) => `- ${f}`), "", portal, input.portalUrl, "", ...EMAIL_TEXT_SIGNATURE].join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:${EMAIL.ink};max-width:560px">` +
    emailBrandBand(input.portalUrl) +
    `<p style="margin:16px 0 0">${esc(greeting)}</p>` +
    `<p>${esc(line)}</p>` +
    `<ul style="margin:0 0 12px;padding-left:20px">${files.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` +
    `<p>${esc(portal)}</p>` +
    `<p style="margin:20px 0">${emailButton(esc(input.portalUrl), "Abrir mi portal")}</p>` +
    emailFooter() +
    `</div>`;
  return { subject, text, html };
}
