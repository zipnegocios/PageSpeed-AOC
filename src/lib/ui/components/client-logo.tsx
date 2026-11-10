import { clientInitials } from "@/server/domain/client-logo";
import { cx } from "@/lib/ui/cx";

/**
 * El logotipo de un cliente en un recuadro con su color de fondo (blanco por defecto), sin recortarlo: `object-contain`
 * con margen interno, así cualquier proporción cabe. Sin imagen, las iniciales del cliente. Decorativo (el nombre va al
 * lado); `alt` solo si va solo.
 */
export function ClientLogo({
  src,
  name,
  bg,
  className,
  alt = "",
}: {
  /** Dirección de la imagen (ruta del panel o del portal); null = sin logotipo. */
  src: string | null;
  name: string;
  bg?: string | null;
  className?: string;
  alt?: string;
}) {
  return (
    <span
      className={cx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border select-none", className)}
      style={{ background: bg ?? "#FFFFFF" }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- logotipo privado ya reducido, servido por una ruta con sesión.
        <img src={src} alt={alt} className="size-full object-contain p-[8%]" />
      ) : (
        <span aria-hidden className="text-[0.4em] font-bold tracking-[0.04em] text-ink-muted">
          {clientInitials(name)}
        </span>
      )}
    </span>
  );
}

/** Dirección del logotipo en el panel (con sesión de administrador). `v` versiona la imagen. */
export const adminLogoUrl = (clientId: string, kind: "icon" | "full", v: number) => `/api/admin/client-logo/${clientId}?k=${kind}&v=${v}`;

/** Dirección del logotipo en el portal del cliente (con el PIN ya validado). */
export const portalLogoUrl = (token: string, kind: "icon" | "full", v: number) => `/c/${token}/logo?k=${kind}&v=${v}`;
