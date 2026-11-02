import { cx } from "@/lib/ui/cx";

/** Ver la regla en el Design System: ≥ 90 ok, 50-89 warning, < 50 danger. */
export function scoreTone(score: number): "ok" | "warning" | "danger" {
  if (score >= 90) return "ok";
  if (score >= 50) return "warning";
  return "danger";
}

const toneClass = { ok: "text-ok", warning: "text-warning", danger: "text-danger" } as const;
const toneWord = { ok: "bueno", warning: "mejorable", danger: "deficiente" } as const;

/**
 * `relative` es necesario: el texto `sr-only` es de posición absoluta y, sin un ancestro posicionado,
 * escaparía del recorte de las tablas con scroll y ensancharía toda la página en móvil.
 *
 * Puntuación de Lighthouse (0-100). El color nunca va solo: el número siempre es visible y el
 * lector de pantalla recibe además la valoración en palabras.
 */
export function Score({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) {
    return <span className={cx("text-ink-muted", className)} aria-label="sin dato">—</span>;
  }
  const tone = scoreTone(value);
  return (
    <span className={cx("relative font-bold tabular-nums", toneClass[tone], className)} title={toneWord[tone]}>
      {value}
      <span className="sr-only"> ({toneWord[tone]})</span>
    </span>
  );
}
