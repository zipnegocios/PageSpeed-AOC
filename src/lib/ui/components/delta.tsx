import { cx } from "@/lib/ui/cx";
import type { Change } from "@/server/domain/history";

/**
 * Cambio de una métrica entre dos auditorías. Siempre en texto (flecha, número y unidad); el color
 * solo refuerza. Mejorar va en `ok`; empeorar, en `danger` (una regresión es una señal).
 */
export function Delta({ change, className }: { change: Change | null; className?: string }) {
  if (!change) return null;
  if (change.verdict === "same") {
    return <span className={cx("text-[14px] text-ink-muted", className)}>= sin cambio</span>;
  }
  const better = change.verdict === "better";
  return (
    <span className={cx("relative text-[14px] font-semibold whitespace-nowrap tabular-nums", better ? "text-ok" : "text-danger", className)}>
      <span aria-hidden>{change.direction === "up" ? "▲" : "▼"}</span> {change.text}
      <span className="sr-only"> ({better ? "mejoró" : "empeoró"})</span>
    </span>
  );
}
