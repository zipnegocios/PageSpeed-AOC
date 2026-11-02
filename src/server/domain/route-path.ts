import { DomainError } from "./errors";

const MAX_PATH = 500;

/**
 * Normaliza una ruta: acepta "/blog/", "blog" o una URL completa. Descarta query y fragmento,
 * colapsa barras repetidas y quita la barra final (salvo en la raíz).
 */
export function normalizePath(raw: string): string {
  let value = raw.trim();
  if (!value) throw new DomainError("INVALID", "Escribe una ruta, por ejemplo /contacto.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      throw new DomainError("INVALID", "La URL no es válida.");
    }
  }
  value = value.split("#")[0]!.split("?")[0]!;
  if (/[\s\u0000-\u001f]/.test(value)) {
    throw new DomainError("INVALID", "La ruta no puede contener espacios ni caracteres de control.");
  }
  value = "/" + value.replace(/^\/+/, "");
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1) value = value.replace(/\/+$/, "");
  if (value.length > MAX_PATH) throw new DomainError("INVALID", "La ruta es demasiado larga.");
  return value;
}

/** Junta el origen del proyecto con una ruta ya normalizada. */
export function routeUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}
