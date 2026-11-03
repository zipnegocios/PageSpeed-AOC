import { layoutChart, type ChartPoint } from "@/lib/chart-layout";
import type { HistoryMetric } from "@/server/domain/history";

const HEIGHT = "h-[220px] md:h-[280px]";

/**
 * Evolución de una métrica, dibujada sin scripts. La línea es un SVG que se estira; los puntos y el
 * texto de los ejes son HTML para que el texto conserve su tamaño legible (≥ 14 px) en cualquier
 * ancho. El valor numérico nunca va solo en el gráfico: quien lo use debe dar un resumen en texto.
 */
export function TrendChart({
  points,
  metric,
  from,
  to,
  threshold,
  label,
}: {
  points: ChartPoint[];
  metric: HistoryMetric;
  from: Date;
  to: Date;
  threshold?: number | null;
  /** Descripción en lenguaje natural para lectores de pantalla. */
  label: string;
}) {
  if (points.length === 0) {
    return (
      <div className={`flex ${HEIGHT} items-center justify-center rounded-sm border border-border bg-surface-100 px-4 text-center text-ink-muted`}>
        Aún no hay auditorías en este periodo.
      </div>
    );
  }
  const l = layoutChart({ points, metric, from, to, threshold });
  const line = l.points.map((p) => `${p.x.toFixed(2)},${(100 - p.y).toFixed(2)}`).join(" ");

  return (
    <div role="img" aria-label={label} className="grid grid-cols-[auto_1fr] gap-x-2">
      <div className={`relative ${HEIGHT} min-w-10`} aria-hidden>
        {l.yTicks.map((t) => (
          <span key={t.label} className="absolute right-0 translate-y-1/2 text-[14px] leading-none text-ink-muted tabular-nums" style={{ bottom: `${t.y}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <div className={`relative ${HEIGHT} border-b border-l border-border-strong bg-surface-100`} aria-hidden>
        {l.yTicks
          .filter((t) => t.y > 0)
          .map((t) => (
            <div key={t.label} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${t.y}%` }} />
          ))}
        {l.threshold !== null ? (
          <>
            <div className="absolute inset-x-0 border-t-2 border-dashed border-danger" style={{ bottom: `${l.threshold}%` }} />
            <span className="absolute left-1 mb-0.5 px-1 text-[14px] leading-4 font-semibold text-danger" style={{ bottom: `${l.threshold}%` }}>
              Meta {threshold}
            </span>
          </>
        ) : null}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          {l.points.length > 1 ? (
            <polyline points={line} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
        {l.points.length <= 60
          ? l.points.map((p, i) => (
              <span key={i} className="absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary" style={{ left: `${p.x}%`, bottom: `${p.y}%` }} />
            ))
          : null}
      </div>
      <span />
      <div className="relative mt-1 h-5" aria-hidden>
        {l.xTicks.map((t, i) => (
          <span
            key={i}
            className={`absolute text-[14px] leading-5 whitespace-nowrap text-ink-muted ${i === 0 ? "" : i === l.xTicks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${t.x}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
