import type { ReactNode } from "react";
import { cx } from "@/lib/ui/cx";

/** Cuántas columnas ocupa un panel en la cuadrícula (1 en móvil; 2 desde 768 px; 4 desde 1280 px). */
const SPAN = {
  1: "",
  2: "md:col-span-2",
  3: "md:col-span-2 xl:col-span-3",
  4: "md:col-span-2 xl:col-span-4",
} as const;

/**
 * Panel de vidrio del dashboard. Título (h3), descripción opcional y una ranura de acciones a la derecha.
 * Con `labelledBy` el panel es una región con nombre para los lectores de pantalla.
 */
export function Panel({
  title,
  description,
  actions,
  span = 1,
  id,
  className,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  span?: keyof typeof SPAN;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const titleId = id && title ? `${id}-titulo` : undefined;
  return (
    <section id={id} aria-labelledby={titleId} className={cx("glass rise flex min-w-0 flex-col gap-4 rounded-lg p-4 md:p-5", SPAN[span], className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {title ? (
              <h3 id={titleId} className="text-[20px] leading-6 font-semibold text-ink">
                {title}
              </h3>
            ) : null}
            {description ? <p className="text-[15px] leading-5 text-ink-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
