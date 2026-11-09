import { BRAND_NAME } from "@/lib/brand";
import { EMAIL, EMAIL_TEXT_SIGNATURE, emailBrandBand, emailButton, emailFooter } from "./email-theme";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" });

/** Correo con el enlace para crear la contraseña (invitación) o para fijar una nueva (restablecimiento). Habla de "tú". */
export function buildInviteEmail(input: { kind: "invite" | "reset"; invitedBy: string; link: string; expiresAt: Date }): { subject: string; text: string; html: string } {
  const invite = input.kind === "invite";
  const subject = invite ? `Te invitaron a ${BRAND_NAME}` : `Crea una contraseña nueva en ${BRAND_NAME}`;
  const line = invite
    ? `${input.invitedBy} te invitó a administrar ${BRAND_NAME} junto con su equipo. Crea tu contraseña para entrar.`
    : `${input.invitedBy} te envió este enlace para que crees una contraseña nueva en ${BRAND_NAME}. La anterior dejará de servir.`;
  const expires = `El enlace sirve una sola vez y vence el ${dateFmt.format(input.expiresAt)} (UTC).`;
  const ignore = "Si no lo esperabas, puedes ignorar este correo: sin el enlace nadie puede entrar con tu correo.";
  const label = invite ? "Crear mi contraseña" : "Crear contraseña nueva";
  const text = ["Hola,", "", line, "", `${label}:`, input.link, "", expires, ignore, "", ...EMAIL_TEXT_SIGNATURE].join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:${EMAIL.ink};max-width:560px">` +
    emailBrandBand(input.link) +
    `<p style="margin:16px 0 0">Hola,</p>` +
    `<p>${esc(line)}</p>` +
    `<p style="margin:20px 0">${emailButton(esc(input.link), esc(label))}</p>` +
    `<p style="color:${EMAIL.muted};font-size:14px">${esc(expires)}</p>` +
    `<p style="color:${EMAIL.muted};font-size:14px">${esc(ignore)}</p>` +
    emailFooter() +
    `</div>`;
  return { subject, text, html };
}
