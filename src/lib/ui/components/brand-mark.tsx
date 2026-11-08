import { LOGO_BOLT_PATH, LOGO_CORNERS_PATH, LOGO_FRAME_PATH, LOGO_GLYPH_VIEWBOX, BRAND_NAME, BRAND_WORDMARK } from "@/lib/brand";
import { cx } from "@/lib/ui/cx";

/**
 * El glifo de PageSpeed: un rayo y un chevron en lima, separados por una ranura diagonal. Para tamaños de 12 a 32 px
 * (barra superior, pies). Toma el color del texto que lo rodea (`text-primary` por defecto); decorativo si va con
 * texto al lado, por eso `aria-hidden`, salvo que se le pase un `title`.
 */
export function BrandGlyph({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox={LOGO_GLYPH_VIEWBOX} className={cx("h-6 w-auto shrink-0 text-primary", className)} fill="currentColor" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d={LOGO_BOLT_PATH} />
    </svg>
  );
}

/**
 * La marca completa: glifo + marco + cuatro marcas de esquina, sobre `surface-100`. Para espacios grandes (inicio de
 * sesión, cabecera del portal). Cuadrada; el tamaño lo da la clase (`size-24`…).
 */
export function BrandMark({ className, title = BRAND_NAME }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={cx("size-20 shrink-0", className)} role="img">
      <title>{title}</title>
      <rect width="256" height="256" className="fill-surface-100" />
      <path d={LOGO_FRAME_PATH} className="fill-brand-frame" />
      <path d={LOGO_CORNERS_PATH} className="stroke-primary" fill="none" strokeWidth="8" />
      <path d={LOGO_BOLT_PATH} className="fill-primary" />
    </svg>
  );
}

/** Glifo y la palabra PAGESPEED, en una línea. La palabra es texto Rajdhani: hereda tipografía y color del contexto. */
export function BrandLockup({ className, wordClassName }: { className?: string; wordClassName?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <BrandGlyph />
      <span className={cx("text-[15px] font-bold tracking-[0.14em] text-ink", wordClassName)}>{BRAND_WORDMARK}</span>
    </span>
  );
}

/**
 * Estela de velocidad: unas líneas lima horizontales que se apagan hacia la izquierda. Decoración, no parte del logo;
 * solo en el inicio de sesión y en la cabecera del portal. Sin degradados ni desenfoque: la opacidad baja por pasos.
 */
export function SpeedTrail({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 40" className={cx("h-10 w-40 shrink-0 text-primary", className)} fill="currentColor" aria-hidden>
      <rect x="40" y="6" width="120" height="4" opacity="0.9" />
      <rect x="8" y="18" width="152" height="4" opacity="0.6" />
      <rect x="64" y="30" width="96" height="4" opacity="0.3" />
    </svg>
  );
}
