/**
 * El índice de los dos informes. Es el **contrato** entre lo que la pestaña «Informes» le promete al cliente y lo que el PDF
 * contiene: la pestaña, la portada, los títulos de cada apartado y los marcadores del PDF salen de esta lista, y una prueba
 * comprueba que el documento los trae todos y en este orden. Si un apartado no tiene datos, el PDF lo muestra igual con su
 * motivo, para que el índice nunca prometa algo que no está.
 */
import type { MeasurementId, MeasurementState } from "./measurements";

export type ReportKind = "summary" | "engineering";
/** `measures`: las mediciones (de `measurements.ts`) que alimentan el apartado; vacío si es texto fijo (método, glosario). */
export type OutlineSection = { id: string; title: string; bullets: string[]; measures: readonly MeasurementId[] };

export const SUMMARY_SECTIONS: readonly OutlineSection[] = [
  { id: "estado", title: "Estado actual por página", measures: ["speed"], bullets: ["Nota de cada página en rendimiento, SEO, accesibilidad y buenas prácticas", "Cómo ha cambiado frente a la medición anterior"] },
  { id: "mejoras", title: "Puntos por mejorar", measures: ["improvements"], bullets: ["Lo que está por debajo de la meta acordada", "Las causas principales, en lenguaje claro"] },
  { id: "experiencia", title: "Experiencia real de los visitantes", measures: ["field"], bullets: ["Cómo vivieron la velocidad tus visitantes reales (Chrome, últimos 28 días)", "Carga, respuesta y estabilidad, con su veredicto"] },
  { id: "evolucion", title: "Evolución", measures: ["speed"], bullets: ["Cómo se ha movido el rendimiento en el periodo", "Comparado con la meta"] },
  { id: "trafico", title: "Visitas y de dónde llegan", measures: ["traffic", "sources", "ai"], bullets: ["Sesiones con su variación y las páginas que más visitas reciben", "Buscadores, redes sociales (Instagram, WhatsApp, Facebook, TikTok, LinkedIn…), otros sitios y directo", "Visitas desde asistentes de IA (mínimo observado)"] },
  { id: "busqueda", title: "Búsqueda en Google", measures: ["search"], bullets: ["Clics, impresiones y posición media con su variación", "Con qué palabras te buscan y qué páginas reciben más clics"] },
  { id: "salud-seo", title: "Salud SEO", measures: ["health"], bullets: ["Errores y avisos del sitio", "Qué es nuevo y qué se resolvió"] },
];

export const ENGINEERING_SECTIONS: readonly OutlineSection[] = [
  { id: "metodo", title: "Cómo se midió", measures: [], bullets: ["Herramientas, versiones y dispositivos simulados", "Escala de notas y metas acordadas"] },
  { id: "notas", title: "Notas por página", measures: ["speed"], bullets: ["Rendimiento, SEO, accesibilidad, buenas prácticas y agentes", "Las páginas más débiles primero"] },
  { id: "rendimiento", title: "Rendimiento a fondo", measures: ["speed"], bullets: ["Carga principal (LCP), estabilidad (CLS) y respuesta (TBT)", "Qué retrasa cada página y cuánto se ahorraría"] },
  { id: "experiencia", title: "Experiencia real de los visitantes", measures: ["field"], bullets: ["LCP, INP, CLS, FCP y TTFB de visitantes reales, en móvil y escritorio", "Reparto de visitas en bueno, mejorable y deficiente"] },
  { id: "fallos", title: "Fallos por rubro", measures: ["improvements"], bullets: ["Accesibilidad, buenas prácticas y SEO, página por página", "Cuántos elementos incumplen cada punto"] },
  { id: "agentes", title: "Navegación agéntica", measures: ["speed"], bullets: ["Comprobaciones superadas por cada página", "Qué mide y por qué todavía está en desarrollo"] },
  { id: "trafico", title: "Visitas y fuentes de tráfico", measures: ["traffic", "sources", "ai"], bullets: ["Sesiones, usuarios, países y páginas más visitadas", "Reparto completo por origen: buscadores, cada red social por nombre, otros sitios, correo, anuncios y directo", "Visitas desde asistentes de IA (mínimo observado)"] },
  { id: "busqueda", title: "Search Console en detalle", measures: ["search"], bullets: ["Clics, impresiones, CTR y posición media", "Consultas, páginas, países y dispositivos"] },
  { id: "salud-seo", title: "Salud SEO del sitio", measures: ["health"], bullets: ["Hallazgos del rastreo técnico, con sus páginas", "Nuevos y resueltos frente a la revisión anterior"] },
  { id: "evolucion", title: "Evolución", measures: ["speed"], bullets: ["Gráficas del rendimiento por página", "Rangos de las demás notas en el periodo"] },
  { id: "glosario", title: "Glosario", measures: [], bullets: ["Qué significa cada sigla y cada medida", "En lenguaje no técnico"] },
];

/**
 * Si el apartado va a traer datos en este informe: «included» si alguna de sus mediciones los tiene, «pending» si están
 * activadas pero sin datos aún y «off» si no están activadas. Null para los apartados de texto fijo.
 */
export function sectionState(section: OutlineSection, states: Record<MeasurementId, MeasurementState>): MeasurementState | null {
  if (section.measures.length === 0) return null;
  const own = section.measures.map((m) => states[m]);
  if (own.includes("included")) return "included";
  return own.includes("pending") ? "pending" : "off";
}

export const REPORT_SECTIONS: Record<ReportKind, readonly OutlineSection[]> = { summary: SUMMARY_SECTIONS, engineering: ENGINEERING_SECTIONS };

export const REPORT_TITLE: Record<ReportKind, string> = { summary: "Informe resumen", engineering: "Informe de ingeniería" };
/** Prefijo del nombre de archivo (y del asunto del correo). */
export const REPORT_FILE_PREFIX: Record<ReportKind, string> = { summary: "resumen", engineering: "informe-ingenieria" };

export const isReportKind = (v: unknown): v is ReportKind => v === "summary" || v === "engineering";

/** `?tipo=` de las direcciones: «resumen» (por defecto, para que los enlaces antiguos sigan valiendo) o «ingenieria». */
export function parseReportKind(raw: string | null | undefined): ReportKind {
  return raw === "ingenieria" || raw === "engineering" ? "engineering" : "summary";
}
export const reportKindParam = (kind: ReportKind): "resumen" | "ingenieria" => (kind === "engineering" ? "ingenieria" : "resumen");
