import { BRAND_NAME, BRAND_WORDMARK, COPYRIGHT } from "@/lib/brand";
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
