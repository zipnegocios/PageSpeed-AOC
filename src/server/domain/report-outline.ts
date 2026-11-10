/**
 * El índice de los dos informes. Es el **contrato** entre lo que la pestaña «Informes» le promete al cliente y lo que el PDF
 * contiene: la pestaña, la portada, los títulos de cada apartado y los marcadores del PDF salen de esta lista, y una prueba
 * comprueba que el documento los trae todos y en este orden. Si un apartado no tiene datos, el PDF lo muestra igual con su
 * motivo, para que el índice nunca prometa algo que no está.
 */
export type ReportKind = "summary" | "engineering";
export type OutlineSection = { id: string; title: string; bullets: string[] };

export const SUMMARY_SECTIONS: readonly OutlineSection[] = [
  { id: "estado", title: "Estado actual por página", bullets: ["Nota de cada página en rendimiento, SEO, accesibilidad y buenas prácticas", "Cómo ha cambiado frente a la medición anterior"] },
  { id: "mejoras", title: "Puntos por mejorar", bullets: ["Lo que está por debajo de la meta acordada", "Las causas principales, en lenguaje claro"] },
  { id: "evolucion", title: "Evolución", bullets: ["Cómo se ha movido el rendimiento en el periodo", "Comparado con la meta"] },
  { id: "trafico", title: "Tráfico y búsqueda", bullets: ["Clics, impresiones y sesiones con su variación", "Las páginas que más visitas reciben"] },
  { id: "salud-seo", title: "Salud SEO", bullets: ["Errores y avisos del sitio", "Qué es nuevo y qué se resolvió"] },
];

export const ENGINEERING_SECTIONS: readonly OutlineSection[] = [
  { id: "metodo", title: "Cómo se midió", bullets: ["Herramienta, versión y dispositivos simulados", "Escala de notas y metas acordadas"] },
  { id: "notas", title: "Notas por página", bullets: ["Rendimiento, SEO, accesibilidad, buenas prácticas y agentes", "Las páginas más débiles primero"] },
  { id: "rendimiento", title: "Rendimiento a fondo", bullets: ["Carga principal (LCP), estabilidad (CLS) y respuesta (TBT)", "Qué retrasa cada página y cuánto se ahorraría"] },
  { id: "fallos", title: "Fallos por rubro", bullets: ["Accesibilidad, buenas prácticas y SEO, página por página", "Cuántos elementos incumplen cada punto"] },
  { id: "agentes", title: "Navegación agéntica", bullets: ["Comprobaciones superadas por cada página", "Qué mide y por qué todavía está en desarrollo"] },
  { id: "salud-seo", title: "Salud SEO del sitio", bullets: ["Hallazgos del rastreo técnico, con sus páginas", "Nuevos y resueltos frente a la revisión anterior"] },
  { id: "evolucion", title: "Evolución", bullets: ["Gráficas del rendimiento por página", "Rangos de las demás notas en el periodo"] },
  { id: "glosario", title: "Glosario", bullets: ["Qué significa cada sigla y cada medida", "En lenguaje no técnico"] },
];

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
