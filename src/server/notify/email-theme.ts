import { BRAND_NAME, BRAND_WORDMARK, COPYRIGHT } from "@/lib/brand";
import type { ClientSender } from "@/server/domain/client-sender";
import { darkToken, lightToken } from "@/lib/tokens";

/**
 * Colores y piezas comunes de los correos. Los correos se leen sobre fondo claro: el texto usa los valores claros de los
 * tokens, y la cabecera y el botón llevan la identidad (navy y lima) con los valores del tema oscuro.
 */
export const EMAIL = {
  ink: lightToken("ink"),
  muted: lightToken("ink-muted"),
  link: lightToken("link"),
  navy: darkToken("surface-100"),
  lime: darkToken("primary"),
  onLime: darkToken("on-primary"),
};

/** Origen (https://dominio) de una dirección de la app, para armar la URL absoluta de las imágenes del correo. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Banda navy con el glifo y la marca en lima. El glifo es un PNG alojado en la app (los clientes de correo no muestran
 * SVG); si las imágenes se bloquean, queda el nombre. `appUrl` es cualquier dirección de la app (el portal, el proyecto).
 */
export function emailBrandBand(appUrl: string): string {
  const origin = originOf(appUrl);
  const img = origin
    ? `<img src="${origin}/brand/logo-glyph-email.png" width="20" height="29" alt="" style="vertical-align:middle;border:0;margin-right:10px">`
    : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.navy};border-left:4px solid ${EMAIL.lime}"><tr>` +
    `<td style="padding:12px 16px">${img}<span style="font-size:13px;letter-spacing:.14em;font-weight:bold;color:${EMAIL.lime};vertical-align:middle">${BRAND_WORDMARK}</span></td></tr></table>`
  );
}

/** Botón lima con texto navy; `href` y `label` ya vienen escapados. */
export function emailButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${EMAIL.lime};color:${EMAIL.onLime};padding:10px 16px;border-radius:2px;text-decoration:none;font-weight:bold">${label}</a>`;
}

/** Pie con el nombre del producto y el copyright. */
export function emailFooter(): string {
  return `<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #D1D5DB;color:${EMAIL.muted};font-size:12px">${BRAND_NAME} · ${COPYRIGHT}</p>`;
}

/** Líneas de cierre de los correos en texto plano. */
export const EMAIL_TEXT_SIGNATURE = [BRAND_NAME, COPYRIGHT];

// ------------------------------------------------------ correos que ve el cliente

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Banda superior de los correos al cliente: el logo de PageSpeed y, junto a él, el nombre de quien firma (su responsable);
 * debajo, la marca y el servicio. Los clientes reconocen a la persona (nombre y apellido) antes que a la marca. El logo es un
 * PNG del propio dominio (los clientes de correo no muestran SVG); si no carga, queda el nombre.
 */
export function clientEmailBand(sender: ClientSender, appUrl: string): string {
  let origin = "";
  try {
    origin = new URL(appUrl).origin;
  } catch {
    /* sin logo: queda el nombre */
  }
  const logo = origin
    ? `<td width="34" valign="middle" style="padding:12px 0 12px 16px"><img src="${origin}/brand/logo-glyph-email.png" width="20" height="29" alt="PageSpeed" style="display:block;border:0"></td>`
    : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.navy};border-left:4px solid ${EMAIL.lime}"><tr>` +
    logo +
    `<td valign="middle" style="padding:12px 16px ${origin ? "12px 10px" : "12px 16px"}"><div style="font-size:16px;font-weight:bold;color:${EMAIL.lime}">${escHtml(sender.name)}</div>` +
    `<div style="font-size:12px;color:#9CA3AF;margin-top:2px">${escHtml(sender.brand)} · ${escHtml(sender.service)}</div></td></tr></table>`
  );
}

/** Firma al pie de los correos al cliente, con una nota opcional encima (cómo cambiar la frecuencia, hasta qué día hay datos…). */
export function clientEmailFooter(sender: ClientSender, note?: string): string {
  return (
    `<div style="border-top:1px solid #D1D5DB;margin-top:22px;padding-top:12px;color:${EMAIL.muted};font-size:12px">` +
    (note ? `<p style="margin:0 0 6px">${escHtml(note)}</p>` : "") +
    `<p style="margin:0"><b>${escHtml(sender.name)}</b> · ${escHtml(sender.brand)}${sender.whatsapp ? ` · WhatsApp ${escHtml(sender.whatsapp)}` : ""}</p></div>`
  );
}

/** Cierre en texto plano de los correos al cliente. */
export function clientTextSignature(sender: ClientSender, note?: string): string[] {
  return [sender.name, sender.brand, "", ...(note ? [note] : []), ...(sender.whatsapp ? [`WhatsApp ${sender.whatsapp}`] : [])];
}
