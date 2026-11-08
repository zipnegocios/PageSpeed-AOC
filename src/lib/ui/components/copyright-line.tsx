import { COPYRIGHT } from "@/lib/brand";
import { cx } from "@/lib/ui/cx";

/** «© 2026 zipnegocios · Gustavo Amarista»: la línea de copyright de los pies. */
export function CopyrightLine({ className }: { className?: string }) {
  return <p className={cx("text-[14px] text-ink-muted", className)}>{COPYRIGHT}</p>;
}
