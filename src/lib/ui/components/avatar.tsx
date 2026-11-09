import { cx } from "@/lib/ui/cx";

const SIZES = { md: "size-10 text-[15px]", lg: "size-16 text-[22px]" } as const;

/** URL de la foto de un administrador: la clave del objeto cambia en cada subida y va en `?v=` para que el navegador no use una vieja. */
export function avatarUrl(adminId: string, avatarKey: string | null): string | null {
  if (!avatarKey) return null;
  const version = avatarKey.slice(avatarKey.lastIndexOf("/") + 1).replace(/\.[a-z]+$/, "");
  return `/api/admin/avatar/${adminId}?v=${version}`;
}

/**
 * Círculo con la foto de la persona o, sin foto, sus iniciales. Decorativo cuando va junto a su nombre; si va solo (el botón
 * del menú), el botón que lo contiene lleva el nombre accesible.
 */
export function Avatar({ initials, src, size = "md", className }: { initials: string; src?: string | null; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden className={cx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-300 font-bold tracking-[0.04em] text-ink select-none", SIZES[size], className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto privada ya reducida a 256 px, servida por una ruta con sesión.
        <img src={src} alt="" width={256} height={256} className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
