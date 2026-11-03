import { METRIC_META, formatMetric, type HistoryMetric } from "@/server/domain/history";

export type ChartPoint = { at: Date; value: number };

export type ChartLayout = {
  /** Posiciones en % del área de trazado (x desde la izquierda, y desde abajo). */
  points: Array<{ x: number; y: number; at: Date; value: number }>;
  yTicks: Array<{ y: number; label: string }>;
  xTicks: Array<{ x: number; label: string }>;
  /** Línea de la meta en % desde abajo, o null si no cae en la escala o no hay meta. */
  threshold: number | null;
  max: number;
};

/** Paso "bonito" (1, 2, 2,5 o 5 por potencia de diez) para que `max` quepa en ~`count` marcas. */
function niceStep(max: number, count: number): number {
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

const dayFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Coloca los puntos de una serie en un área de trazado. Las puntuaciones usan siempre 0-100; los
 * tiempos y el CLS parten de cero hasta un máximo "bonito" por encima del mayor valor. El eje X va
 * de `from` a `to`, de modo que los huecos entre auditorías se ven como huecos.
 */
export function layoutChart(input: {
  points: ChartPoint[];
  metric: HistoryMetric;
  from: Date;
  to: Date;
  threshold?: number | null;
}): ChartLayout {
  const { metric, from, to } = input;
  const isScore = METRIC_META[metric].kind === "score";
  const peak = Math.max(0, ...input.points.map((p) => p.value));

  let max = 100;
  let ticks = [0, 25, 50, 75, 100];
  if (!isScore) {
    const step = niceStep(Math.max(peak * 1.1, metric === "cls" ? 0.1 : 1), 4);
    const n = Math.max(1, Math.ceil((peak * 1.1 || step) / step));
    max = step * n;
    ticks = Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 1000) / 1000);
  }

  const span = Math.max(1, to.getTime() - from.getTime());
  const x = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - from.getTime()) / span) * 100));
  const y = (v: number) => Math.min(100, Math.max(0, (v / max) * 100));

  const xTicks = [0, 1 / 3, 2 / 3, 1].map((f) => {
    const at = new Date(from.getTime() + span * f);
    return { x: f * 100, label: dayFormat.format(at) };
  });

  return {
    points: input.points.map((p) => ({ x: x(p.at), y: y(p.value), at: p.at, value: p.value })),
    yTicks: ticks.map((t) => ({ y: y(t), label: formatMetric(metric, t) })),
    xTicks,
    threshold: input.threshold !== null && input.threshold !== undefined && input.threshold <= max ? y(input.threshold) : null,
    max,
  };
}
