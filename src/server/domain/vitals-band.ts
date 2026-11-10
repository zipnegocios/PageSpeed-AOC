/**
 * Bandas de las métricas web esenciales (umbrales de Google): LCP en milisegundos, CLS sin unidad y TBT en milisegundos.
 * Se pintan con el mismo código de color que las puntuaciones (ok, mejorable, deficiente) y siempre con su número.
 */
export type VitalKind = "lcp" | "cls" | "tbt";
export type VitalTone = "ok" | "warning" | "danger";

const LIMITS: Record<VitalKind, readonly [good: number, poor: number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  tbt: [200, 600],
};

export function vitalTone(kind: VitalKind, value: number | null | undefined): VitalTone | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const [good, poor] = LIMITS[kind];
  return value <= good ? "ok" : value <= poor ? "warning" : "danger";
}

const num = (v: number, min: number, max: number) => v.toLocaleString("es", { minimumFractionDigits: min, maximumFractionDigits: max });

/** «2,4 s» (LCP), «0,02» (CLS) o «120 ms» (TBT); «—» sin dato. */
export function formatVital(kind: VitalKind, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (kind === "lcp") return `${num(value / 1000, 0, 1)} s`;
  if (kind === "cls") return num(value, 2, 2);
  return `${Math.round(value)} ms`;
}
