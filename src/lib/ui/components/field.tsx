import type { InputHTMLAttributes } from "react";
import { cx } from "@/lib/ui/cx";

/** Campo de formulario con etiqueta visible. El `id` enlaza etiqueta y control. */
export function Field({
  label,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        name={id}
        className={cx(
          "min-h-11 rounded-sm border border-border-strong bg-surface-100 px-3 text-[17px] text-ink",
          "placeholder:text-ink-muted",
          className,
        )}
        {...props}
      />
    </div>
  );
}
