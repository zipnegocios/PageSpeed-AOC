import { RING_RADIUS, ringDashes } from "@/lib/ring";
import { cx } from "@/lib/ui/cx";
import { scoreTone } from "./score";

const WORD = { ok: "bueno", warning: "mejorable", danger: "deficiente" } as const;
const TEXT = { ok: "text-ok", warning: "text-warning", danger: "text-danger" } as const;

/**
 * Anillo de 270 grados para una puntuación de Lighthouse. El arco lleva el color de su banda (90+ ok, 50-89 warning,
 * menos de 50 danger) con un brillo suave; el número va en el centro y, en tamaño grande, la palabra de la banda debajo.
 * Sin dato: pista vacía y una raya.
 */
export function ScoreRing({ value, label, size = 112, className }: { value: number | null | undefined; label: string; size?: number; className?: string }) {
  const has = value !== null && value !== undefined;
  const tone = has ? scoreTone(value) : null;
  const dashes = ringDashes(has ? value : 0);
  const big = size >= 96;
  const showWord = size >= 140; // en anillos menores la palabra no cabe dentro del arco; el número y el aria-label ya la dicen
  return (
    <div className={cx("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={has ? `${label}: ${value}, ${WORD[tone!]}` : `${label}: sin dato`} className="block">
        <g transform="rotate(135 50 50)" fill="none" strokeLinecap="round">
          <circle cx="50" cy="50" r={RING_RADIUS} stroke="var(--surface-300)" strokeWidth="8" strokeDasharray={dashes.track} />
          {has && value > 0 ? (
            <circle
              className="ring-arc"
              cx="50"
              cy="50"
              r={RING_RADIUS}
              stroke={`var(--${tone})`}
              strokeWidth="8"
              strokeDasharray={dashes.arc}
              style={{ filter: `drop-shadow(0 0 5px var(--${tone}))` }}
            />
          ) : null}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={cx("font-bold tracking-[-0.02em] tabular-nums", size >= 140 ? "text-[56px] leading-[56px]" : big ? "text-[38px] leading-[38px]" : "text-[22px] leading-6", tone ? TEXT[tone] : "text-ink-muted")}>
          {has ? value : "—"}
        </span>
        {showWord ? <span className="text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">{has ? WORD[tone!] : "sin dato"}</span> : null}
      </div>
    </div>
  );
}
