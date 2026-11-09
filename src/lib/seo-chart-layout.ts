import { niceStep } from "@/lib/chart-layout";
import { formatCount, formatDayShort } from "@/lib/seo-format";

export type SeriesPoint = { date: string; value: number };

export type SeriesLayout = {
  /** Posiciones en % del área de trazado (x desde la izquierda, y desde abajo). */
  points: Array<{ x: number; y: number; date: string; value: number }>;
  yTicks: Array<{ y: number; label: string }>;
  xTicks: Array<{ x: number; label: string }>;
  max: number;
  /** Punto más alto (el primero si hay empate); null si todo es cero. */
  peak: SeriesPoint | null;
  total: number;
};

/**
 * Coloca una serie diaria en un área de trazado. El eje Y parte siempre de cero y llega a un máximo «bonito» por encima
 * del valor más alto; el eje X reparte los días por igual (la serie viene con los días sin datos ya rellenados con 0).
 */
export function layoutSeries(series: SeriesPoint[]): SeriesLayout {
  const n = series.length;
  const peakValue = Math.max(0, ...series.map((p) => p.value));
  const step = niceStep(Math.max(peakValue * 1.1, 4), 4);
  const intervals = Math.max(1, Math.ceil((peakValue * 1.1 || step) / step));
  const max = step * intervals;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);

  const tickIndexes = [...new Set([0, 1 / 3, 2 / 3, 1].map((f) => Math.round(f * (n - 1))))].filter((i) => i >= 0 && i < n);
  return {
    points: series.map((p, i) => ({ x: x(i), y: Math.min(100, (p.value / max) * 100), date: p.date, value: p.value })),
    yTicks: Array.from({ length: intervals + 1 }, (_, i) => ({ y: ((i * step) / max) * 100, label: formatCount(i * step) })),
    xTicks: tickIndexes.map((i) => ({ x: x(i), label: formatDayShort(series[i]!.date) })),
    max,
    peak: peakValue > 0 ? (series.find((p) => p.value === peakValue) ?? null) : null,
    total: series.reduce((sum, p) => sum + p.value, 0),
  };
}
