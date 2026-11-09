import { layoutSeries, type SeriesPoint } from "@/lib/seo-chart-layout";
import { formatCount, formatDayMedium } from "@/lib/seo-format";

const HEIGHT = "h-[180px] md:h-[220px]";

/** Colores de serie del Design System (marcas, nunca texto). La serie 2 se distingue además por el trazo discontinuo. */
const SERIES = {
  1: { stroke: "stroke-chart-1", fill: "fill-chart-1/10", dot: "bg-chart-1", dash: undefined },
  2: { stroke: "stroke-chart-2", fill: "fill-chart-2/10", dot: "bg-chart-2", dash: "6 4" },
} as const;

/**
 * Evolución diaria de una métrica, dibujada en el servidor sin scripts. La línea es un SVG que se estira; los ejes y los
 * puntos son HTML para que el texto conserve su tamaño legible. El valor no depende del color: el título dice qué se mide,
 * el resumen da el total y el máximo, y el `aria-label` describe la serie para lectores de pantalla.
 */
export function SeoChart({ title, unit, series, tone = 1 }: { title: string; /** «clics», «sesiones»: en plural, minúsculas. */ unit: string; series: SeriesPoint[]; tone?: 1 | 2 }) {
  const l = layoutSeries(series);
  const style = SERIES[tone];
  const line = l.points.map((p) => `${p.x.toFixed(2)},${(100 - p.y).toFixed(2)}`).join(" ");
  const area = l.points.length > 1 ? `0,100 ${line} 100,100` : "";
  const first = series[0];
  const last = series.at(-1);
  const summary = l.peak
    ? `Total ${formatCount(l.total)} ${unit}. Máximo: ${formatCount(l.peak.value)} el ${formatDayMedium(l.peak.date)}.`
    : `Sin ${unit} en este periodo.`;
  const label = `${title}: ${summary}${first && last ? ` Del ${formatDayMedium(first.date)} al ${formatDayMedium(last.date)}.` : ""}`;

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 text-[19px] leading-6 font-semibold text-ink">
          <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden className="shrink-0">
            <line x1="1" y1="4" x2="27" y2="4" className={style.stroke} strokeWidth="3" strokeLinecap="round" strokeDasharray={style.dash} />
          </svg>
          {title}
        </span>
        <span className="text-[15px] leading-5 text-ink-muted">{summary}</span>
      </figcaption>
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
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {area ? <polygon points={area} className={style.fill} /> : null}
            {l.points.length > 1 ? (
              <polyline points={line} fill="none" className={style.stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={style.dash} vectorEffect="non-scaling-stroke" />
            ) : null}
          </svg>
          {l.points.length <= 31
            ? l.points.map((p) => (
                <span key={p.date} title={`${formatDayMedium(p.date)}: ${formatCount(p.value)} ${unit}`} className={`absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ${style.dot}`} style={{ left: `${p.x}%`, bottom: `${p.y}%` }} />
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
    </figure>
  );
}
