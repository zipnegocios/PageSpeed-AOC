import { swapLocale } from "lighthouse/shared/localization/swap-locale.js";
import { ReportGenerator } from "lighthouse/report/generator/report-generator.js";

export type UiLocale = "es" | "en";
export const DEFAULT_LOCALE: UiLocale = "es";

export function parseLocale(raw: string | null | undefined): UiLocale {
  return raw === "en" ? "en" : "es";
}

type Lhr = Record<string, unknown>;

/**
 * Pasa un resultado guardado al idioma pedido. Lighthouse guarda los textos como identificador + valores,
 * así que se traduce al leer (también lo ya guardado) sin duplicar nada. Si el resultado no trae la
 * información para traducir (p. ej. uno muy antiguo o de prueba), se devuelve tal cual.
 */
export function localizeLhr<T extends Lhr>(lhr: T, locale: UiLocale): T {
  try {
    const target = locale === "es" ? "es" : "en-US";
    const current = (lhr.configSettings as { locale?: string } | undefined)?.locale;
    if (current === target) return lhr;
    return swapLocale(lhr as never, target).lhr as unknown as T;
  } catch {
    return lhr;
  }
}

// El informe oficial lleva su propio menú de herramientas (guardar, abrir en el visor de Google, compartir) y un
// botón de mapa de rectángulos que abre una página externa: la aplicación ofrece lo que corresponde y lo oculta.
const HIDE_TOOLS = "<style>.lh-tools,.lh-footer__version_issue,.lh-button.lh-report-icon--treemap{display:none!important}</style>";

/** HTML autocontenido del informe oficial de Lighthouse en el idioma pedido. */
export function renderOfficialReport(lhr: Lhr, locale: UiLocale): string {
  const html = ReportGenerator.generateReportHtml(localizeLhr(lhr, locale) as never).replace(/<html lang="[^"]*"/, `<html lang="${locale}"`);
  return html.includes("</head>") ? html.replace("</head>", `${HIDE_TOOLS}</head>`) : HIDE_TOOLS + html;
}

/**
 * Cabeceras del informe: se sirve para mostrarlo en un marco aislado. `sandbox` sin `allow-same-origin` lo deja
 * en un origen opaco (sin cookies ni acceso a la aplicación) y la política no permite ninguna conexión de red.
 */
export const REPORT_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": [
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; "),
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
};
