/**
 * Qué significa cada sigla y cada medida que se enseña en la pestaña «Rutas», dicho en lenguaje llano, con su regla de colores y la lectura
 * del valor actual. Lógica pura: la usa la burbuja `Hint` y se prueba aparte.
 */
import { scoreBand } from "./score-band";
import { formatVital, vitalTone, type VitalKind } from "./vitals-band";

export type HintKey = "R" | "S" | "A" | "B" | "IA" | "LCP" | "CLS" | "TBT" | "AG";
export type HintRule = "score" | "fraction" | VitalKind;
export type HintTone = "ok" | "warning" | "danger" | "none";

export type HintDef = {
  /** La sigla tal como se ve en pantalla. */
  sigla: string;
  name: string;
  /** Una o dos frases sin jerga: qué se mide y para qué le sirve a quien tiene el sitio. */
  text: string;
  rule: HintRule;
  /** Cómo se lee cada banda: bueno, mejorable y deficiente. Null si la medida no tiene bandas. */
  ranges: readonly [good: string, average: string, poor: string] | null;
};

const SCORE_RANGES = ["90 a 100", "50 a 89", "0 a 49"] as const;

export const METRIC_HINTS: Record<HintKey, HintDef> = {
  R: { sigla: "R", name: "Rendimiento", text: "Qué tan rápido carga y responde tu página. Una nota alta significa menos espera para quien la visita.", rule: "score", ranges: SCORE_RANGES },
  S: { sigla: "S", name: "SEO", text: "Qué tan fácil es que Google entienda tu página y la muestre cuando alguien busca lo que ofreces.", rule: "score", ranges: SCORE_RANGES },
  A: { sigla: "A", name: "Accesibilidad", text: "Qué tan fácil es usar la página para todas las personas, también quienes ven poco, no oyen o usan solo el teclado.", rule: "score", ranges: SCORE_RANGES },
  B: { sigla: "B", name: "Buenas prácticas", text: "Si la página sigue las reglas modernas de calidad y seguridad: conexión segura y sin errores ocultos.", rule: "score", ranges: SCORE_RANGES },
  IA: {
    sigla: "IA",
    name: "Navegación agéntica",
    text: "Cuántas comprobaciones superó la página para que asistentes de inteligencia artificial puedan entenderla y usarla. Es una medida nueva y todavía no tiene meta.",
    rule: "fraction",
    ranges: null,
  },
  LCP: { sigla: "LCP", name: "Carga principal", text: "El tiempo que tarda en aparecer lo más grande de la página, como la foto o el título principal.", rule: "lcp", ranges: ["Hasta 2,5 s", "De 2,5 a 4 s", "Más de 4 s"] },
  CLS: { sigla: "CLS", name: "Estabilidad", text: "Cuánto se mueven los elementos mientras la página carga. Un número bajo evita toques equivocados.", rule: "cls", ranges: ["Hasta 0,1", "De 0,1 a 0,25", "Más de 0,25"] },
  TBT: { sigla: "TBT", name: "Respuesta", text: "Cuánto tiempo la página no responde a tus toques mientras termina de cargar.", rule: "tbt", ranges: ["Hasta 200 ms", "De 200 a 600 ms", "Más de 600 ms"] },
  AG: {
    sigla: "IA",
    name: "Agentes",
    text: "Comprobaciones superadas, de las que usan los asistentes de inteligencia artificial para entender la página. Medida nueva, en desarrollo.",
    rule: "fraction",
    ranges: null,
  },
};

export type HintReading = { tone: HintTone; /** «bueno», «mejorable», «deficiente» o «sin meta». */ word: string; /** «72», «2,4 s», «12/20». */ valueText: string };

const WORD = { ok: "bueno", warning: "mejorable", danger: "deficiente" } as const;

/**
 * La lectura de un valor concreto: su color y su palabra. `value` es la nota (R, S, A, B), el valor de la métrica (LCP y TBT en milisegundos,
 * CLS sin unidad) o el texto «superadas/totales» (IA y Agentes). Null cuando no hay dato.
 */
export function readHint(key: HintKey, value: number | string | null | undefined): HintReading | null {
  if (value === null || value === undefined || value === "") return null;
  const rule = METRIC_HINTS[key].rule;
  if (rule === "fraction") return { tone: "none", word: "sin meta", valueText: String(value) };
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (rule === "score") {
    const b = scoreBand(n);
    return { tone: b.tone, word: b.word, valueText: String(n) };
  }
  const tone = vitalTone(rule, n);
  return tone ? { tone, word: WORD[tone], valueText: formatVital(rule, n) } : null;
}
