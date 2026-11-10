/**
 * Todo lo que se mide de un sitio, en una sola lista. La usan las cuatro superficies que lo cuentan al cliente (el Resumen del
 * portal, la pestaña Informes, los dos PDF y los correos) para que **nombren lo mismo**: si se agrega una medición, aparece en
 * todas o una prueba falla. Lógica pura.
 */
export type MeasurementId = "speed" | "improvements" | "field" | "search" | "traffic" | "sources" | "ai" | "health";

export type Measurement = {
  id: MeasurementId;
  /** Cómo se llama para el cliente. */
  title: string;
  /** De dónde sale el dato. */
  source: string;
  /** Una frase: qué responde. */
  question: string;
  /** Si solo se muestra cuando el administrador activó el seguimiento de tráfico y búsqueda para el cliente. */
  needsSeoAccess: boolean;
};

export const MEASUREMENTS: readonly Measurement[] = [
  { id: "speed", title: "Velocidad y calidad de cada página", source: "Lighthouse (Google)", question: "¿Qué tan rápida, visible, accesible y bien hecha está cada página, en móvil y en escritorio?", needsSeoAccess: false },
  { id: "improvements", title: "Puntos por mejorar", source: "Lighthouse (Google)", question: "¿Qué hay que corregir para llegar a la meta acordada y cuánto pesa cada cosa?", needsSeoAccess: false },
  { id: "field", title: "Experiencia real de los visitantes", source: "Chrome UX Report (Google)", question: "¿Cómo vivieron la velocidad de tu sitio visitantes reales en los últimos 28 días?", needsSeoAccess: false },
  { id: "search", title: "Búsqueda en Google", source: "Google Search Console", question: "¿Cuántas veces apareces en Google, cuántos clics recibes, con qué buscan y en qué posición estás?", needsSeoAccess: true },
  { id: "traffic", title: "Visitas al sitio", source: "Google Analytics 4", question: "¿Cuánta gente llega, a qué páginas y desde qué países?", needsSeoAccess: true },
  { id: "sources", title: "De dónde llegan las visitas", source: "Google Analytics 4", question: "¿Llegan de buscadores, de redes sociales (WhatsApp, Instagram, Facebook, TikTok, LinkedIn…), de otros sitios o directo?", needsSeoAccess: true },
  { id: "ai", title: "Visitas desde asistentes de IA", source: "Google Analytics 4", question: "¿Cuántas visitas llegan desde ChatGPT, Perplexity, Gemini, Claude o Copilot? (mínimo observado)", needsSeoAccess: true },
  { id: "health", title: "Salud SEO del sitio", source: "Revisión técnica propia", question: "¿Hay errores o avisos que impidan que Google encuentre y muestre bien tus páginas?", needsSeoAccess: true },
];

export const MEASUREMENT_BY_ID: Readonly<Record<MeasurementId, Measurement>> = Object.fromEntries(MEASUREMENTS.map((m) => [m.id, m])) as Record<MeasurementId, Measurement>;

/** El estado de cada medición para un cliente: disponible (hay datos y puede verlos), sin datos todavía o no activada. */
export type MeasurementState = "included" | "pending" | "off";

/** Las mediciones que el cliente ve como «Incluido» y las que no, según el acceso a tráfico y búsqueda y lo que ya tiene datos. */
export function measurementStates(input: { seoAccess: boolean; has: Partial<Record<MeasurementId, boolean>> }): Record<MeasurementId, MeasurementState> {
  return Object.fromEntries(
    MEASUREMENTS.map((m) => {
      if (m.needsSeoAccess && !input.seoAccess) return [m.id, "off"];
      return [m.id, input.has[m.id] === false ? "pending" : "included"];
    }),
  ) as Record<MeasurementId, MeasurementState>;
}

export const MEASUREMENT_STATE_LABEL: Record<MeasurementState, string> = { included: "Incluido", pending: "Incluido · aún sin datos", off: "No activado para tu sitio" };
