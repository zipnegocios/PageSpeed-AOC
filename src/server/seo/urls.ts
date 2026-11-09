/**
 * Normaliza una URL o ruta a una "clave de página" comparable entre fuentes: GSC entrega URLs completas
 * y GA4 entrega `pagePath`. Quita host, parámetros, ancla, `index.html` y la barra final (salvo en la raíz).
 */
export function pagePath(input: string): string {
  let path = input;
  if (!input.startsWith("/")) {
    try {
      path = new URL(input).pathname;
    } catch {
      path = input;
    }
  }
  path = path.split("?")[0] ?? "";
  path = path.split("#")[0] ?? "";
  try {
    path = decodeURI(path);
  } catch {
    // Una secuencia % inválida se deja tal cual.
  }
  path = path.replace(/\/index\.html?$/i, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** Host en minúsculas de una URL, o null si no es una URL válida. */
export function hostOf(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}
