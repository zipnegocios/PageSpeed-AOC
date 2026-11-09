import { DomainError } from "./errors";

/** Prefijo de las fotos en R2. Distinto de las claves de auditorías (`cliente/proyecto/...`): los slugs no llevan `_`. */
export const AVATAR_PREFIX = "_avatars/";
/** Tamaño máximo de la foto ya reducida (el navegador la deja en ~20 KB; esto es el tope del servidor). */
export const AVATAR_MAX_BYTES = 1_000_000;
export const NAME_MAX = 60;

export type ImageKind = { mime: "image/png" | "image/jpeg" | "image/webp"; ext: "png" | "jpg" | "webp" };

/** Qué imagen es, por sus primeros bytes. Nunca se confía en el tipo que declara el navegador. */
export function detectImage(bytes: Uint8Array): ImageKind | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  return null;
}

/** La foto debe ser PNG, JPEG o WebP y no pasar del tope. */
export function assertAvatar(bytes: Uint8Array): ImageKind {
  if (bytes.length === 0) throw new DomainError("INVALID", "Elige una foto.");
  if (bytes.length > AVATAR_MAX_BYTES) throw new DomainError("INVALID", "La foto pesa demasiado. Elige una más pequeña.");
  const kind = detectImage(bytes);
  if (!kind) throw new DomainError("INVALID", "La foto debe ser PNG, JPEG o WebP.");
  return kind;
}

type Named = { email: string; firstName?: string | null; lastName?: string | null };

/** «Nombre Apellido»; si no hay ninguno, el correo. */
export function displayName(p: Named): string {
  const full = [p.firstName, p.lastName].map((x) => x?.trim()).filter(Boolean).join(" ");
  return full || p.email;
}

/** Hasta dos letras en mayúscula: la inicial del nombre y la del apellido; sin nombre, la del correo. */
export function initials(p: Named): string {
  const parts = [p.firstName, p.lastName].map((x) => x?.trim()).filter((x): x is string => Boolean(x));
  const letters = parts.length > 0 ? parts.map((x) => [...x][0]!).join("") : [...p.email.trim()][0] ?? "?";
  return letters.slice(0, 2).toLocaleUpperCase("es");
}
