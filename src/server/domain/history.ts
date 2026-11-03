/** Métricas que se pueden graficar y comparar en el tiempo. */
export const HISTORY_METRICS = ["performance", "seo", "accessibility", "best_practices", "lcp", "tbt", "cls"] as const;
export type HistoryMetric = (typeof HISTORY_METRICS)[number];

export type MetricKind = "score" | "seconds" | "milliseconds" | "cls";

export const METRIC_META: Record<HistoryMetric, { label: string; short: string; kind: MetricKind; higherIsBetter: boolean }> = {
  performance: { label: "Rendimiento", short: "Rendimiento", kind: "score", higherIsBetter: true },
  seo: { label: "SEO", short: "SEO", kind: "score", higherIsBetter: true },
  accessibility: { label: "Accesibilidad", short: "Accesibilidad", kind: "score", higherIsBetter: true },
  best_practices: { label: "Buenas prácticas", short: "Prácticas", kind: "score", higherIsBetter: true },
  lcp: { label: "LCP (contenido principal)", short: "LCP", kind: "seconds", higherIsBetter: false },
  tbt: { label: "TBT (bloqueo del hilo)", short: "TBT", kind: "milliseconds", higherIsBetter: false },
  cls: { label: "CLS (desplazamiento)", short: "CLS", kind: "cls", higherIsBetter: false },
};

export function parseMetric(raw: string | undefined | null): HistoryMetric {
  return (HISTORY_METRICS as readonly string[]).includes(raw ?? "") ? (raw as HistoryMetric) : "performance";
}

export const PERIODS = [7, 30, 90, 365] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(raw: string | undefined | null): Period {
  const n = Number(raw);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

export const PERIOD_LABEL: Record<Period, string> = { 7: "7 días", 30: "30 días", 90: "90 días", 365: "1 año" };

/** Lo mínimo de una auditoría correcta para sacar una métrica. */
export type MetricRow = {
  scorePerformance: number | null;
  scoreSeo: number | null;
  scoreAccessibility: number | null;
  scoreBestPractices: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: string | number | null;
};

export function metricValue(row: MetricRow, metric: HistoryMetric): number | null {
  switch (metric) {
    case "performance":
      return row.scorePerformance;
    case "seo":
      return row.scoreSeo;
    case "accessibility":
      return row.scoreAccessibility;
    case "best_practices":
      return row.scoreBestPractices;
    case "lcp":
      return row.lcpMs;
    case "tbt":
      return row.tbtMs;
    case "cls": {
      if (row.cls === null || row.cls === undefined) return null;
      const n = Number(row.cls);
      return Number.isFinite(n) ? n : null;
    }
  }
}

export function formatMetric(metric: HistoryMetric, value: number | null): string {
  if (value === null) return "—";
  switch (METRIC_META[metric].kind) {
    case "score":
      return String(Math.round(value));
    case "seconds":
      return `${(value / 1000).toFixed(1)} s`;
    case "milliseconds":
      return `${Math.round(value)} ms`;
    case "cls":
      return value.toFixed(3);
  }
}

export type Change = {
  /** Diferencia con signo, en la unidad de la métrica (puntos, ms, CLS). */
  diff: number;
  direction: "up" | "down" | "same";
  /** Si el cambio es una mejora, un empeoramiento o no hay cambio. */
  verdict: "better" | "worse" | "same";
  /** "5 puntos", "0,3 s", "40 ms", "0,050". */
  text: string;
};

/** Variación entre dos valores. En tiempos y CLS, subir es empeorar. */
export function computeChange(metric: HistoryMetric, current: number | null, previous: number | null): Change | null {
  if (current === null || previous === null) return null;
  const meta = METRIC_META[metric];
  const raw = current - previous;
  const diff = meta.kind === "cls" ? Math.round(raw * 1000) / 1000 : meta.kind === "seconds" ? Math.round(raw / 100) / 10 : Math.round(raw);
  if (diff === 0) return { diff: 0, direction: "same", verdict: "same", text: "sin cambio" };
  const direction = diff > 0 ? "up" : "down";
  const improved = meta.higherIsBetter ? diff > 0 : diff < 0;
  const abs = Math.abs(diff);
  const text =
    meta.kind === "score"
      ? `${abs} ${abs === 1 ? "punto" : "puntos"}`
      : meta.kind === "seconds"
        ? `${abs.toFixed(1)} s`
        : meta.kind === "milliseconds"
          ? `${abs} ms`
          : abs.toFixed(3);
  return { diff, direction, verdict: improved ? "better" : "worse", text };
}

/** Cuántos días mira atrás cada periodo, para pedir los datos. */
export const periodStart = (now: Date, days: Period): Date => new Date(now.getTime() - days * 86_400_000);

/** Promedio entero de los valores presentes; null si no hay ninguno. */
export function average(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}
