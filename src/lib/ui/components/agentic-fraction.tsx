import { cx } from "@/lib/ui/cx";

/**
 * "Navegación con agentes": comprobaciones superadas sobre totales. No es una nota de 0 a 100, así que
 * nunca lleva color de banda; no abre alertas ni tiene umbral (Lighthouse la marca "en desarrollo").
 */
export function AgenticFraction({ value, className, hint = false }: { value: { passed: number; total: number } | null | undefined; className?: string; hint?: boolean }) {
  if (!value || value.total === 0) {
    return <span className={cx("text-ink-muted", className)} aria-label="sin dato">—</span>;
  }
  return (
    <span className="flex flex-col gap-1">
      <span className={cx("font-bold text-ink tabular-nums", className)}>
        {value.passed}/{value.total}
        <span className="sr-only"> comprobaciones superadas</span>
      </span>
      {hint ? <span className="text-[14px] leading-4 text-ink-muted">En desarrollo: Google puede cambiar estas comprobaciones.</span> : null}
    </span>
  );
}
