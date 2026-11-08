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

/** Banda navy con la marca en lima y mayúsculas. */
export function emailBrandBand(): string {
  return (
    `<div style="background:${EMAIL.navy};padding:12px 16px;border-left:4px solid ${EMAIL.lime}">` +
    `<span style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:bold;color:${EMAIL.lime}">AOC PageSpeed</span></div>`
  );
}

/** Botón lima con texto navy; `href` y `label` ya vienen escapados. */
export function emailButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${EMAIL.lime};color:${EMAIL.onLime};padding:10px 16px;border-radius:2px;text-decoration:none;font-weight:bold">${label}</a>`;
}
