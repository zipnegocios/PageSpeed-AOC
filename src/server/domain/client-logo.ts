import { DomainError } from "./errors";

/** Prefijo de los logotipos en R2. Como `_avatars/`, no choca con las claves de auditorías (los slugs no llevan `_`). */
export const LOGO_PREFIX = "_logos/";
/** Tope del PNG ya reducido por el navegador (a ~512 px pesa 20–80 KB; esto es el límite del servidor). */
export const LOGO_MAX_BYTES = 512_000;
export const LOGO_MIN_SIDE = 16;
export const LOGO_MAX_SIDE = 1024;

/** `icon`: el isotipo, cuadrado (icono de la app y celdas pequeñas). `full`: el logotipo completo, de cualquier proporción. */
export type LogoKind = "icon" | "full";
export const LOGO_KINDS: readonly LogoKind[] = ["icon", "full"];
export const isLogoKind = (v: unknown): v is LogoKind => v === "icon" || v === "full";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Ancho y alto de un PNG, leídos de su cabecera IHDR. null si no es un PNG. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || PNG_SIGNATURE.some((byte, i) => b[i] !== byte)) return null;
  // Tras la firma: longitud (4) + «IHDR» (4) + ancho (4) + alto (4).
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const u32 = (o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/**
 * Valida un logotipo. Solo PNG (conserva la transparencia y lo entienden el PDF y los iconos de la app): el navegador
 * convierte SVG, JPEG y WebP antes de subirlo, y aquí se vuelve a comprobar por firma, tamaño y proporción.
 */
export function assertLogo(bytes: Uint8Array, kind: LogoKind): { width: number; height: number } {
  if (bytes.length === 0) throw new DomainError("INVALID", "Elige una imagen.");
  if (bytes.length > LOGO_MAX_BYTES) throw new DomainError("INVALID", "El logotipo pesa demasiado. Elige una imagen más pequeña.");
  const size = pngSize(bytes);
  if (!size) throw new DomainError("INVALID", "El logotipo debe ser un PNG.");
  const { width, height } = size;
  if (width < LOGO_MIN_SIDE || height < LOGO_MIN_SIDE) throw new DomainError("INVALID", "La imagen es demasiado pequeña.");
  if (width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) throw new DomainError("INVALID", "La imagen es demasiado grande.");
  const ratio = width / height;
  if (kind === "icon" && (ratio < 0.5 || ratio > 2)) throw new DomainError("INVALID", "El isotipo debe ser casi cuadrado (como mucho el doble de ancho que de alto).");
  if (kind === "full" && (ratio < 0.25 || ratio > 8)) throw new DomainError("INVALID", "El logotipo es demasiado alargado.");
  return size;
}

/** Color de fondo del logotipo: `#RRGGBB` en mayúsculas. Vacío = sin color propio (fondo blanco). */
export function parseLogoBg(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(v);
  if (!m) throw new DomainError("INVALID", "El color debe ser de la forma #RRGGBB.");
  return `#${m[1]!.toUpperCase()}`;
}

/** Lo que el resto de la aplicación necesita saber del logotipo de un cliente para dibujarlo. */
export type ClientLogoInfo = { icon: boolean; full: boolean; bg: string | null; v: number };

export function logoInfo(c: { logoIconKey: string | null; logoFullKey: string | null; logoBg: string | null; logoUpdatedAt: Date | null }): ClientLogoInfo | null {
  if (!c.logoIconKey && !c.logoFullKey) return null;
  return { icon: Boolean(c.logoIconKey), full: Boolean(c.logoFullKey), bg: c.logoBg, v: c.logoUpdatedAt?.getTime() ?? 0 };
}

/** Hasta dos letras en mayúscula del nombre del cliente, para cuando no hay logotipo. */
export function clientInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!)
    .join("")
    .toLocaleUpperCase("es");
}
