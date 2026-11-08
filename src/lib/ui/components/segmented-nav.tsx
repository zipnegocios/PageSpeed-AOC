import Link from "next/link";
import { cx } from "@/lib/ui/cx";

export type SegmentedItem = {
  label: string;
  href: string;
  current: boolean;
  /** Enlace común (sin precarga de Next): para rutas que cambian algo, como el idioma. */
  plain?: boolean;
  /** No disponible: se muestra atenuado, sin enlace (aria-disabled). */
  disabled?: boolean;
  /** Al navegar, vuelve al inicio de la página (por defecto no: las opciones de un mismo panel conservan la posición). */
  scroll?: boolean;
};

/** Fila de enlaces con aspecto de control segmentado: elige una opción sin necesitar scripts. */
export function SegmentedNav({ label, items }: { label: string; items: SegmentedItem[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => {
        const className = cx(
          "inline-flex min-h-11 items-center rounded-sm px-3 text-[15px] font-semibold",
          item.disabled ? "cursor-not-allowed bg-surface-300 text-ink-muted opacity-70" : item.current ? "bg-primary text-on-primary" : "bg-surface-300 text-ink hover:bg-border",
        );
        if (item.disabled) {
          return (
            <span key={item.label} aria-disabled="true" className={className}>
              {item.label}
            </span>
          );
        }
        const current = item.current ? ("page" as const) : undefined;
        return item.plain ? (
          <a key={item.label} href={item.href} aria-current={current} className={className}>
            {item.label}
          </a>
        ) : (
          <Link key={item.label} href={item.href} scroll={item.scroll ?? false} aria-current={current} className={className}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
