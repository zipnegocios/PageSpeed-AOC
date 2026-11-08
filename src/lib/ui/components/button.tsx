import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/ui/cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-border-strong bg-transparent text-ink hover:bg-surface-300",
  ghost: "text-ink-muted hover:bg-surface-300 hover:text-ink",
  danger: "border border-danger text-danger hover:bg-danger-subtle",
};

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-[17px] font-semibold",
        "press cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
