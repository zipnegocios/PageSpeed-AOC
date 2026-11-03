/**
 * Versión de un resultado de Lighthouse apta para mostrar al cliente cuando la ruta exige sesión: sin
 * capturas ni fragmentos de HTML ni textos de elementos, que podrían contener datos del usuario de prueba.
 * No modifica el original.
 */
const DROP_AUDITS = ["final-screenshot", "screenshot-thumbnails", "full-page-screenshot"];

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "snippet") continue;
      out[k] = walk(v);
    }
    if (o.type === "node") {
      // El texto del elemento puede ser contenido del usuario: se deja solo su selector.
      out.nodeLabel = typeof o.selector === "string" ? o.selector : "";
    }
    return out;
  }
  return value;
}

export function redactLhr<T extends Record<string, unknown>>(lhr: T): T {
  const copy = walk(lhr) as Record<string, unknown>;
  // Las auditorías de capturas se vacían, no se borran: el informe de Lighthouse las busca por su identificador.
  const audits = copy.audits as Record<string, Record<string, unknown> | undefined> | undefined;
  if (audits) {
    for (const id of DROP_AUDITS) {
      const audit = audits[id];
      if (audit) audits[id] = { ...audit, details: undefined };
    }
  }
  delete copy.fullPageScreenshot;
  return copy as T;
}
