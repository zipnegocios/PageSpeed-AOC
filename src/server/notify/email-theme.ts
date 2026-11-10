import { BRAND_NAME, BRAND_WORDMARK, COPYRIGHT } from "@/lib/brand";
import { SUPPORT_CONTACT } from "@/lib/contact";
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

/**
 * Quién firma los correos al cliente. Los clientes reconocen a la persona (nombre y apellido) antes que a la marca, así que
 * el nombre va primero; «zipnegocios» y el servicio quedan debajo. El producto («PageSpeed») no aparece nunca.
 */
export const CLIENT_SENDER = {
  name: SUPPORT_CONTACT.name,
  brand: SUPPORT_CONTACT.brand,
  service: "Informes técnicos web",
  whatsapp: SUPPORT_CONTACT.whatsapp,
} as const;

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Banda superior de los correos al cliente: tu nombre y, debajo, la marca y el servicio. Sin imágenes (no hay nada que se rompa). */
export function clientEmailBand(): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.navy};border-left:4px solid ${EMAIL.lime}"><tr>` +
    `<td style="padding:12px 16px"><div style="font-size:16px;font-weight:bold;color:${EMAIL.lime}">${escHtml(CLIENT_SENDER.name)}</div>` +
    `<div style="font-size:12px;color:#9CA3AF;margin-top:2px">${escHtml(CLIENT_SENDER.brand)} · ${escHtml(CLIENT_SENDER.service)}</div></td></tr></table>`
  );
}

/** Firma al pie de los correos al cliente, con una nota opcional encima (cómo cambiar la frecuencia, hasta qué día hay datos…). */
export function clientEmailFooter(note?: string): string {
  return (
    `<div style="border-top:1px solid #D1D5DB;margin-top:22px;padding-top:12px;color:${EMAIL.muted};font-size:12px">` +
    (note ? `<p style="margin:0 0 6px">${escHtml(note)}</p>` : "") +
    `<p style="margin:0"><b>${escHtml(CLIENT_SENDER.name)}</b> · ${escHtml(CLIENT_SENDER.brand)} · WhatsApp ${escHtml(CLIENT_SENDER.whatsapp)}</p></div>`
  );
}

/** Cierre en texto plano de los correos al cliente. */
export function clientTextSignature(note?: string): string[] {
  return [CLIENT_SENDER.name, CLIENT_SENDER.brand, "", ...(note ? [note] : []), `WhatsApp ${CLIENT_SENDER.whatsapp}`];
}
