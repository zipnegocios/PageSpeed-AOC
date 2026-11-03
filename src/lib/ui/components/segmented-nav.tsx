import Link from "next/link";
import { cx } from "@/lib/ui/cx";

export type SegmentedItem = { label: string; href: string; current: boolean };

/** Fila de enlaces con aspecto de control segmentado: elige una opción sin necesitar scripts. */
export function SegmentedNav({ label, items }: { label: string; items: SegmentedItem[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          scroll={false}
          aria-current={item.current ? "page" : undefined}
          className={cx(
            "inline-flex min-h-11 items-center rounded-sm px-3 text-[15px] font-semibold",
            item.current ? "bg-primary-subtle text-on-primary-subtle" : "bg-surface-300 text-ink hover:bg-border",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
