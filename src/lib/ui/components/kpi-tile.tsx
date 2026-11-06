import type { Change } from "@/server/domain/history";
import { cx } from "@/lib/ui/cx";
import { Delta } from "./delta";
import { Sparkline } from "./sparkline";

const TEXT = { ok: "text-ok", warning: "text-warning", danger: "text-danger" } as const;

/**
 * Cifra clave: etiqueta en mayúsculas, valor grande, variación opcional y miniatura opcional. Con `hero`, el valor es una
 * cifra héroe (56 px): solo una por pantalla. Los números grandes usan cifras proporcionales, no tabulares.
 */
export function KpiTile({
  label,
  value,
  unit,
  hero = false,
  delta,
  spark,
  hint,
  tone,
  className,
}: {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  hero?: boolean;
  delta?: Change | null;
  spark?: { values: number[]; label: string };
  hint?: string;
  tone?: "ok" | "warning" | "danger";
  className?: string;
}) {
  const empty = value === null || value === undefined;
  return (
    <div className={cx("flex min-w-0 flex-col gap-2", className)}>
      <span className="text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</span>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <span className={cx("font-bold tracking-[-0.02em]", hero ? "text-[56px] leading-[56px]" : "text-[36px] leading-9", empty ? "text-ink-muted" : tone ? TEXT[tone] : "text-ink")}>
          {empty ? "—" : value}
          {unit && !empty ? <span className="ml-1 text-[20px] font-semibold text-ink-muted">{unit}</span> : null}
        </span>
        {spark ? <Sparkline values={spark.values} label={spark.label} width={96} height={32} /> : null}
      </div>
      {delta ? <Delta change={delta} /> : null}
      {hint ? <span className="text-[14px] leading-5 text-ink-muted">{hint}</span> : null}
    </div>
  );
}
