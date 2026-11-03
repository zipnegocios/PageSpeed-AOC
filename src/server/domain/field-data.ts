/**
 * Datos reales de usuarios (Chrome UX Report). Lógica pura: interpreta la respuesta de la API y valora cada métrica
 * con los umbrales de Core Web Vitals que usa PageSpeed Insights.
 */
export const FIELD_METRICS = ["lcp", "inp", "cls", "fcp", "ttfb"] as const;
export type FieldMetric = (typeof FIELD_METRICS)[number];

/** Nombre de cada métrica en la API de CrUX. */
export const CRUX_NAMES: Record<FieldMetric, string> = {
  lcp: "largest_contentful_paint",
  inp: "interaction_to_next_paint",
  cls: "cumulative_layout_shift",
  fcp: "first_contentful_paint",
  ttfb: "experimental_time_to_first_byte",
};

export const FIELD_LABEL: Record<FieldMetric, string> = {
  lcp: "LCP (contenido principal)",
  inp: "INP (respuesta a la interacción)",
  cls: "CLS (desplazamiento)",
  fcp: "FCP (primer contenido)",
  ttfb: "TTFB (respuesta del servidor)",
};

/** Hasta aquí es "bueno" y a partir del segundo valor es "deficiente" (ms; CLS sin unidad). */
export const THRESHOLDS: Record<FieldMetric, { good: number; poor: number }> = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
  fcp: { good: 1800, poor: 3000 },
  ttfb: { good: 800, poor: 1800 },
};

export type FieldMetricData = {
  /** Percentil 75: el valor que 3 de cada 4 visitas igualan o mejoran. */
  p75: number | null;
  /** Reparto de visitas, de 0 a 100: bueno / necesita mejorar / deficiente. */
  good: number;
  needsImprovement: number;
  poor: number;
};

export type FieldMetrics = Partial<Record<FieldMetric, FieldMetricData>>;
export type Rating = "good" | "needs-improvement" | "poor";

export function rate(metric: FieldMetric, p75: number | null): Rating | null {
  if (p75 === null) return null;
  const t = THRESHOLDS[metric];
  return p75 <= t.good ? "good" : p75 <= t.poor ? "needs-improvement" : "poor";
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const pct = (d: unknown) => Math.round(Math.max(0, Math.min(1, num(d) ?? 0)) * 1000) / 10;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

export type ParsedRecord = { metrics: FieldMetrics; first: string | null; last: string | null };

const date = (d: unknown) => {
  const o = obj(d);
  const y = num(o?.year);
  const m = num(o?.month);
  const day = num(o?.day);
  return y && m && day ? `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
};

/** Interpreta `record` de la respuesta de CrUX. Ignora métricas ausentes o mal formadas. */
export function parseRecord(body: unknown): ParsedRecord | null {
  const record = obj(obj(body)?.record);
  const raw = obj(record?.metrics);
  if (!record || !raw) return null;
  const metrics: FieldMetrics = {};
  for (const m of FIELD_METRICS) {
    const entry = obj(raw[CRUX_NAMES[m]]);
    const hist = Array.isArray(entry?.histogram) ? entry.histogram : [];
    if (!entry || hist.length < 3) continue;
    const [good, mid, poor] = hist.map((h) => pct(obj(h)?.density));
    metrics[m] = { p75: num(obj(entry.percentiles)?.p75), good: good ?? 0, needsImprovement: mid ?? 0, poor: poor ?? 0 };
  }
  if (Object.keys(metrics).length === 0) return null;
  const period = obj(record.collectionPeriod);
  return { metrics, first: date(period?.firstDate), last: date(period?.lastDate) };
}

export type Assessment = "passed" | "failed" | "no-data";

/**
 * Evaluación de Core Web Vitals como en PageSpeed Insights: se aprueba si LCP, INP y CLS están en "bueno" en el
 * percentil 75. Si falta alguno de los tres no se puede afirmar aprobado; con uno ya deficiente sí se puede suspender.
 */
export function assess(metrics: FieldMetrics | null | undefined): Assessment {
  if (!metrics) return "no-data";
  const ratings = (["lcp", "inp", "cls"] as const).map((m) => rate(m, metrics[m]?.p75 ?? null));
  if (ratings.every((r) => r === null)) return "no-data";
  if (ratings.some((r) => r === "needs-improvement" || r === "poor")) return "failed";
  return ratings.every((r) => r === "good") ? "passed" : "no-data";
}

/** Valor legible: tiempos en segundos o milisegundos, CLS con tres decimales. */
export function formatField(metric: FieldMetric, p75: number | null): string {
  if (p75 === null) return "—";
  if (metric === "cls") return p75.toFixed(3);
  if (metric === "lcp" || metric === "fcp") return `${(p75 / 1000).toFixed(1)} s`;
  return `${Math.round(p75)} ms`;
}
