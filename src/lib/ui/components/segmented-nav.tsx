import Link from "next/link";
import { cx } from "@/lib/ui/cx";

export type SegmentedItem = {
  label: string;
  href: string;
  current: boolean;
  /** Enlace común (sin precarga de Next): para rutas que cambian algo, como el idioma. */
  plain?: boolean;
};

/** Fila de enlaces con aspecto de control segmentado: elige una opción sin necesitar scripts. */
export function SegmentedNav({ label, items }: { label: string; items: SegmentedItem[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => {
        const className = cx(
          "inline-flex min-h-11 items-center rounded-sm px-3 text-[15px] font-semibold",
          item.current ? "bg-primary-subtle text-on-primary-subtle" : "bg-surface-300 text-ink hover:bg-border",
        );
        const current = item.current ? ("page" as const) : undefined;
        return item.plain ? (
          <a key={item.label} href={item.href} aria-current={current} className={className}>
            {item.label}
          </a>
        ) : (
          <Link key={item.label} href={item.href} scroll={false} aria-current={current} className={className}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
