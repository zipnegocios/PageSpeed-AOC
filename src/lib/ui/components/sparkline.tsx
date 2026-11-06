import { sparklineLayout } from "@/lib/sparkline";
import { cx } from "@/lib/ui/cx";

/**
 * Miniatura de una serie de puntuaciones (SVG sin scripts): línea de 2 px, lavado del 10 % bajo ella y un punto final de
 * 8 px con un anillo del color de la superficie. Sin ejes; el `aria-label` dice el primer valor, el último y el cambio.
 */
export function Sparkline({ values, label, width = 120, height = 36, className }: { values: number[]; label: string; width?: number; height?: number; className?: string }) {
  const l = sparklineLayout(values, width, height);
  if (!l) {
    return (
      <span className={cx("text-ink-muted", className)} aria-label={`${label}: sin datos suficientes`}>
        —
      </span>
    );
  }
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const diff = last - first;
  const summary = `${label}: de ${first} a ${last}${diff === 0 ? ", sin cambio" : diff > 0 ? `, subió ${diff}` : `, bajó ${-diff}`} en ${values.length} días con datos`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={summary} className={cx("block overflow-visible", className)}>
      <path d={l.area} fill="var(--chart-1)" fillOpacity="0.1" />
      <path className="spark-line" d={l.line} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={l.last.x} cy={l.last.y} r="4" fill="var(--chart-1)" stroke="var(--surface-200)" strokeWidth="2" />
    </svg>
  );
}
