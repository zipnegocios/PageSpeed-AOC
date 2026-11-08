import { cx } from "@/lib/ui/cx";

/**
 * Título de página: en mayúsculas, con un corte lima detrás de la primera palabra (el texto encima va en navy para
 * conservar el contraste). Si el título es una ruta ("/contacto") se deja tal cual, sin mayúsculas ni corte: las rutas distinguen mayúsculas.
 */
export function PageTitle({ children, className }: { children: string; className?: string }) {
  const isPath = children.startsWith("/");
  if (isPath) return <h1 className={cx("text-[34px] leading-[38px] font-bold tracking-[-0.02em] break-all text-ink", className)}>{children}</h1>;
  const [first = "", ...rest] = children.split(" ");
  return (
    <h1 className={cx("text-[34px] leading-[38px] font-bold tracking-[-0.02em] break-words text-ink uppercase", className)}>
      <span className="title-cut">{first}</span>
      {rest.length > 0 ? ` ${rest.join(" ")}` : null}
    </h1>
  );
}
