import type { ReactNode } from "react";
import { cx } from "@/lib/ui/cx";

const tones = {
  neutral: "bg-surface-300 text-ink",
  primary: "bg-primary text-on-primary",
  ok: "bg-ok-subtle text-on-ok-subtle",
  danger: "bg-danger-subtle text-on-danger-subtle",
  // Sin color de relleno propio (el contraste ya está validado en `neutral`): el aro ámbar refuerza el texto.
  warning: "bg-surface-300 text-ink ring-1 ring-inset ring-warning",
} as const;

/** Etiqueta de estado. Siempre lleva texto: el color solo refuerza. */
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-sm px-2 py-1 text-[14px] leading-4 font-semibold", tones[tone])}>
      {children}
    </span>
  );
}
