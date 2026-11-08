import type { ReactNode } from "react";
import { cx } from "@/lib/ui/cx";

const tones = {
  danger: "border-danger bg-danger-subtle text-on-danger-subtle",
  info: "border-primary bg-primary-subtle text-on-primary-subtle",
} as const;

/** Aviso en línea. El texto siempre lleva la información; el color solo la refuerza. */
export function Alert({ tone = "info", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-sm border-l-[3px] px-3 py-2 text-[15px] leading-5", tones[tone])}>
      {children}
    </div>
  );
}
