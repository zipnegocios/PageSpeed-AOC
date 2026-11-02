import { DomainError } from "./errors";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 40;

/** "Ñandú Café S.A." -> "nandu-cafe-s-a". Devuelve "" si no queda ningún carácter válido. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}

export function isValidSlug(slug: string): boolean {
  return slug.length >= 2 && slug.length <= MAX_SLUG && SLUG_RE.test(slug);
}

/** El slug forma el prefijo de R2 (cliente/proyecto/año/mes/...), por eso se valida estricto. */
export function requireSlug(slug: string): string {
  if (!isValidSlug(slug)) {
    throw new DomainError(
      "INVALID",
      "El identificador solo admite minúsculas, números y guiones (2 a 40 caracteres).",
    );
  }
  return slug;
}
