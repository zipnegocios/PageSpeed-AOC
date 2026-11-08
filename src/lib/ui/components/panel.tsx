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
 * Panel HUD del dashboard: superficie sólida con corchetes en dos esquinas. Título (h3), descripción opcional, una ranura de
 * acciones a la derecha y, opcionalmente, un `tag`: microtexto técnico decorativo («SYS.01 // FLOTA») que no aporta información.
 */
export function Panel({
  title,
  description,
  actions,
  span = 1,
  id,
  tag,
  className,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  span?: keyof typeof SPAN;
  id?: string;
  tag?: string;
  className?: string;
  children: ReactNode;
}) {
  const titleId = id && title ? `${id}-titulo` : undefined;
  return (
    <section id={id} aria-labelledby={titleId} className={cx("hud hud-brackets rise relative flex min-w-0 flex-col gap-4 rounded-lg p-4 md:p-5", SPAN[span], className)}>
      {tag ? (
        <span aria-hidden className="pointer-events-none absolute right-5 bottom-1 font-mono text-[11px] leading-3 tracking-[0.12em] text-ink-muted uppercase select-none">
          {tag}
        </span>
      ) : null}
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
