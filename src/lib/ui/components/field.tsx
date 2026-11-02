import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/ui/cx";

const labelClass = "text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted";
const controlClass =
  "rounded-sm border border-border-strong bg-surface-100 px-3 text-[17px] text-ink placeholder:text-ink-muted";

function Wrapper({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-[15px] leading-5 text-ink-muted">{hint}</p> : null}
    </div>
  );
}

type Common = { label: string; id: string; hint?: string };

/** Campo de texto con etiqueta visible. El `id` enlaza etiqueta y control (y es el `name`). */
export function Field({ label, id, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & Common) {
  return (
    <Wrapper label={label} id={id} hint={hint}>
      <input id={id} name={id} className={cx("min-h-11", controlClass, className)} {...props} />
    </Wrapper>
  );
}

export function TextareaField({ label, id, hint, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & Common) {
  return (
    <Wrapper label={label} id={id} hint={hint}>
      <textarea id={id} name={id} rows={3} className={cx("py-2", controlClass, className)} {...props} />
    </Wrapper>
  );
}

export function SelectField({
  label,
  id,
  hint,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & Common) {
  return (
    <Wrapper label={label} id={id} hint={hint}>
      <select id={id} name={id} className={cx("min-h-11", controlClass, className)} {...props}>
        {children}
      </select>
    </Wrapper>
  );
}

export function CheckboxField({
  label,
  id,
  hint,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & Common) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-[17px] text-ink">
        <input id={id} name={id} type="checkbox" className="size-5 accent-primary" {...props} />
        {label}
      </label>
      {hint ? <p className="text-[15px] leading-5 text-ink-muted">{hint}</p> : null}
    </div>
  );
}
