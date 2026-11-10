import type { ImprovementImpact, ImprovementItem } from "./improvements";

/**
 * Lo que Lighthouse llama «Eliminar recursos que bloquean el renderizado», dicho como lo diría una persona sin formación
 * técnica: qué le pasa a la página y por qué importa. Solo las comprobaciones más frecuentes; las demás caen al título de
 * Lighthouse (ya en español). Cada frase debe poder leerse sola, en una línea de teléfono.
 */
const GLOSSARY: Record<string, string> = {
  // ---- Rendimiento (ahorros y diagnósticos, también las «insights» de Lighthouse 13)
  "render-blocking-resources": "Hay archivos que retrasan que la página empiece a verse",
  "render-blocking-insight": "Hay archivos que retrasan que la página empiece a verse",
  "unused-javascript": "Se descarga código que la página no llega a usar",
  "unused-css-rules": "Se descargan estilos que la página no usa",
  "unminified-javascript": "El código no está comprimido y pesa más de lo necesario",
  "unminified-css": "Los estilos no están comprimidos y pesan más de lo necesario",
  "uses-optimized-images": "Las imágenes pesan más de lo necesario",
  "modern-image-formats": "Las imágenes usan formatos antiguos y pesados",
  "uses-responsive-images": "Se cargan imágenes más grandes de lo que se muestra",
  "image-delivery-insight": "Las imágenes se entregan más grandes o pesadas de lo necesario",
  "offscreen-images": "Se cargan imágenes que todavía no se ven en pantalla",
  "efficient-animated-content": "Hay animaciones que pesan mucho",
  "uses-text-compression": "El contenido de texto se envía sin comprimir",
  "server-response-time": "El servidor tarda en responder",
  "document-latency-insight": "La primera respuesta del servidor es lenta",
  "uses-long-cache-ttl": "Los archivos no se guardan en el navegador del visitante para próximas visitas",
  "cache-insight": "Los archivos no se guardan en el navegador del visitante para próximas visitas",
  "dom-size": "La página tiene una estructura demasiado grande y compleja",
  "dom-size-insight": "La página tiene una estructura demasiado grande y compleja",
  "total-byte-weight": "La página pesa demasiado en total",
  "mainthread-work-breakdown": "El navegador tarda demasiado en procesar la página",
  "bootup-time": "El código tarda demasiado en ejecutarse",
  "third-party-summary": "Servicios externos (chat, anuncios, analítica) ralentizan la página",
  "third-parties-insight": "Servicios externos (chat, anuncios, analítica) ralentizan la página",
  "long-tasks": "Hay tareas que bloquean la página durante demasiado tiempo",
  "layout-shifts": "Los elementos se mueven mientras la página carga",
  "cls-culprits-insight": "Los elementos se mueven mientras la página carga",
  "unsized-images": "Hay imágenes sin tamaño fijo y la página «salta» al cargarlas",
  "font-display": "El texto tarda en aparecer mientras se cargan las fuentes",
  "font-display-insight": "El texto tarda en aparecer mientras se cargan las fuentes",
  redirects: "La página pasa por redirecciones antes de cargar",
  "lcp-lazy-loaded": "La imagen principal se carga demasiado tarde",
  "lcp-discovery-insight": "La imagen o el contenido principal se descubre demasiado tarde",
  "largest-contentful-paint-element": "El elemento principal de la página tarda en aparecer",
  "critical-request-chains": "Hay archivos que dependen unos de otros y se cargan en cadena",
  "network-dependency-tree-insight": "Hay archivos que dependen unos de otros y se cargan en cadena",
  "duplicated-javascript": "Se carga el mismo código más de una vez",
  "duplicated-javascript-insight": "Se carga el mismo código más de una vez",
  "legacy-javascript": "Se envía código antiguo que los navegadores actuales no necesitan",
  "legacy-javascript-insight": "Se envía código antiguo que los navegadores actuales no necesitan",
  "forced-reflow-insight": "El código obliga al navegador a recalcular la página una y otra vez",
  "modern-http-insight": "El servidor usa un protocolo antiguo y más lento",
  "uses-http2": "El servidor usa un protocolo antiguo y más lento",
  "non-composited-animations": "Hay animaciones que hacen trabajar de más al navegador",
  "uses-rel-preconnect": "Faltan conexiones anticipadas a servicios que la página necesita",
  "viewport-insight": "La página no está bien ajustada para pantallas de móvil",
  "largest-contentful-paint": "El contenido principal tarda en aparecer",
  "total-blocking-time": "La página tarda en responder a los toques mientras carga",
  "cumulative-layout-shift": "Los elementos se mueven mientras la página carga",
  "first-contentful-paint": "Tarda en aparecer lo primero en pantalla",
  "speed-index": "La página se va mostrando lentamente",
  // ---- Accesibilidad
  "color-contrast": "Hay textos con poco contraste respecto al fondo y cuesta leerlos",
  "image-alt": "Hay imágenes sin descripción para personas que no pueden verlas",
  "button-name": "Hay botones sin nombre que los lectores de pantalla puedan leer",
  "link-name": "Hay enlaces sin texto que explique a dónde llevan",
  label: "Hay campos de formulario sin etiqueta que los explique",
  "form-field-multiple-labels": "Hay campos de formulario con varias etiquetas que se contradicen",
  "html-has-lang": "La página no declara en qué idioma está",
  "html-lang-valid": "El idioma declarado de la página no es válido",
  "document-title": "La página no tiene título",
  "heading-order": "Los títulos y subtítulos no siguen un orden lógico",
  "empty-heading": "Hay títulos vacíos",
  "landmark-one-main": "La página no marca cuál es su contenido principal",
  bypass: "No hay forma de saltar el menú para ir directo al contenido",
  "target-size": "Hay botones o enlaces demasiado pequeños o pegados para tocarlos bien",
  "tap-targets": "Hay botones o enlaces demasiado pequeños o pegados para tocarlos bien",
  "meta-viewport": "La página impide ampliar el texto en el móvil",
  "frame-title": "Hay contenido incrustado sin título descriptivo",
  list: "Hay listas mal construidas",
  listitem: "Hay elementos de lista fuera de una lista",
  "select-name": "Hay desplegables sin nombre que los explique",
  "input-image-alt": "Hay botones de imagen sin descripción",
  "link-in-text-block": "Los enlaces dentro de un texto solo se distinguen por el color",
  "duplicate-id-aria": "Hay identificadores repetidos que confunden a los lectores de pantalla",
  "aria-allowed-attr": "Hay atributos de accesibilidad mal usados",
  "aria-required-attr": "Faltan atributos de accesibilidad necesarios",
  "aria-valid-attr": "Hay atributos de accesibilidad no válidos",
  "aria-valid-attr-value": "Hay valores de accesibilidad no válidos",
  "aria-hidden-focus": "Hay elementos ocultos que aun así se pueden seleccionar con el teclado",
  tabindex: "El orden de navegación con el teclado está alterado",
  "meta-refresh": "La página se recarga sola, lo que desorienta",
  "td-has-header": "Hay tablas sin encabezados",
  "th-has-data-cells": "Hay tablas con encabezados sin datos",
  "video-caption": "Hay vídeos sin subtítulos",
  // ---- SEO
  "meta-description": "La página no tiene una descripción para mostrar en los buscadores",
  "link-text": "Hay enlaces con textos poco descriptivos («haz clic aquí»)",
  "crawlable-anchors": "Hay enlaces que los buscadores no pueden seguir",
  "is-crawlable": "La página pide a los buscadores que no la indexen",
  "http-status-code": "La página responde con un error",
  hreflang: "Las versiones de la página en otros idiomas están mal declaradas",
  canonical: "La dirección principal de la página (canónica) está mal declarada",
  "robots-txt": "El archivo robots.txt tiene errores",
  "font-size": "El texto es demasiado pequeño para leerlo en el móvil",
  viewport: "La página no está ajustada para pantallas de móvil",
  // ---- Buenas prácticas
  "is-on-https": "Hay contenido que no usa conexión segura (https)",
  "errors-in-console": "La página produce errores internos que no se ven pero afectan su funcionamiento",
  deprecations: "La página usa funciones que los navegadores van a dejar de admitir",
  "inspector-issues": "El navegador detecta problemas técnicos en la página",
  "image-aspect-ratio": "Hay imágenes deformadas (estiradas o aplastadas)",
  "image-size-responsive": "Hay imágenes con poca resolución para pantallas nítidas",
  charset: "La página no declara su codificación de caracteres",
  doctype: "A la página le falta el tipo de documento",
  "geolocation-on-start": "La página pide la ubicación apenas se abre",
  "notification-on-start": "La página pide permiso para notificar apenas se abre",
  "no-vulnerable-libraries": "Se usan librerías con fallos de seguridad conocidos",
  "csp-xss": "Falta una protección contra ataques de inyección de código",
  "third-party-cookies": "Se usan cookies de terceros que los navegadores están bloqueando",
  "paste-preventing-inputs": "Hay campos que impiden pegar texto",
  "valid-source-maps": "Faltan archivos de ayuda para diagnosticar errores",
};

/** La frase llana de una comprobación; sin glosario, el título de Lighthouse. */
export function plainImprovement(item: Pick<ImprovementItem, "id" | "title">): string {
  return GLOSSARY[item.id] ?? item.title;
}

/** ¿El glosario cubre esta comprobación? (para medir la cobertura y para las pruebas). */
export const hasGlossary = (id: string): boolean => id in GLOSSARY;

/** El impacto en una línea corta: «≈ 1,9 s», «≈ 120 KiB» o «3 elementos»; vacío si no hay dato. El tiempo manda sobre el peso. */
export function formatImpact(impact: ImprovementImpact | null | undefined): string {
  if (!impact) return "";
  const n = (v: number, max: number) => v.toLocaleString("es", { maximumFractionDigits: max });
  if (impact.ms) return impact.ms >= 1000 ? `≈ ${n(impact.ms / 1000, 1)} s` : `≈ ${n(Math.round(impact.ms / 10) * 10, 0)} ms`;
  if (impact.bytes) return impact.bytes >= 1024 * 1024 ? `≈ ${n(impact.bytes / (1024 * 1024), 1)} MiB` : `≈ ${n(Math.round(impact.bytes / 1024), 0)} KiB`;
  if (impact.count) return `${impact.count} ${impact.count === 1 ? "elemento" : "elementos"}`;
  return "";
}
