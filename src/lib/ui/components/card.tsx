import type { ReactNode } from "react";
import { cx } from "@/lib/ui/cx";

/** Panel con título opcional. Es el contenedor estándar de cada bloque de una pantalla. */
export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("glass flex flex-col gap-4 rounded-lg p-4 md:p-6", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            {title ? <h2 className="text-[24px] leading-7 font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="text-[15px] leading-5 text-ink-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
