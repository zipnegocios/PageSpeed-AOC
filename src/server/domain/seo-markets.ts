import { pagePath } from "@/server/seo/urls";
import { DomainError } from "./errors";

/**
 * Idiomas del sitio, identificados por el prefijo de la ruta (`es` → `/es`). Lógica pura: valida lo que escribe la
 * persona administradora y decide a qué idioma pertenece cada página. El prefijo `/` es el idioma por defecto: lo que no
 * cae bajo ningún otro prefijo.
 */

export type Market = { lang: string; prefix: string };

/** Prefijo del idioma por defecto (páginas sin prefijo de idioma). */
export const ROOT = "/";
/** Clave del grupo «sin idioma»: páginas que no caen bajo ningún prefijo cuando no hay idioma por defecto. */
export const NO_LANG = "none";

const invalid = (message: string): never => {
  throw new DomainError("INVALID", message);
};

/** Código de idioma de 2 o 3 letras (es, en, pt). Se rechaza el país (`es-MX`): los datos se separan por idioma, no por país. */
export function normalizeLang(raw: string): string {
  const text = raw.trim().toLowerCase();
  if (/^[a-z]{2,3}-[a-z0-9]{2,4}$/.test(text)) return invalid("Usa solo el idioma (por ejemplo es), sin el país (es-MX): los países ya se separan solos en los datos.");
  return /^[a-z]{2,3}$/.test(text) ? text : invalid("El idioma es un código de 2 o 3 letras, por ejemplo es, en o pt.");
}

/** Prefijo de ruta: acepta `es`, `/es`, `/es/` o una URL completa. Vacío o `/` es el idioma por defecto. */
export function normalizePrefix(raw: string): string {
  let text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname;
    } catch {
      return invalid("La dirección del prefijo no es válida. Ejemplo: /es.");
    }
  }
  text = text.toLowerCase().replace(/\/+$/, "");
  if (text === "" || text === "/") return ROOT;
  if (!text.startsWith("/")) text = `/${text}`;
  return /^\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/.test(text) ? text : invalid("El prefijo debe ser una ruta como /es o /en (letras, números y guiones).");
}

/** Mensaje de por qué `next` no cabe junto a los idiomas ya declarados, o null si cabe. */
export function marketConflict(existing: Market[], next: Market): string | null {
  if (existing.some((m) => m.lang === next.lang)) return "Ese idioma ya está declarado.";
  if (existing.some((m) => m.prefix === next.prefix)) return next.prefix === ROOT ? "Ya hay un idioma por defecto (sin prefijo)." : "Ese prefijo ya lo usa otro idioma.";
  return null;
}

/** Del prefijo más largo al más corto, y el idioma por defecto al final: así `/en-au` se prueba antes que `/en`. */
export function orderMarkets<T extends Market>(markets: T[]): T[] {
  return [...markets].sort((a, b) => (a.prefix === ROOT ? 1 : 0) - (b.prefix === ROOT ? 1 : 0) || b.prefix.length - a.prefix.length || a.lang.localeCompare(b.lang));
}

/** Idioma de una ruta o URL: el del prefijo más largo que la contiene, o el idioma por defecto; null si no hay ninguno. */
export function classifyPath(input: string, markets: Market[]): string | null {
  const path = pagePath(input).toLowerCase();
  const ordered = orderMarkets(markets);
  for (const m of ordered) {
    if (m.prefix === ROOT) return m.lang;
    if (path === m.prefix || path.startsWith(`${m.prefix}/`)) return m.lang;
  }
  return null;
}

/**
 * Idioma pedido en la dirección (`?idioma=es`): el código si el proyecto lo declaró, `none` si pide las páginas sin idioma
 * y no hay idioma por defecto, o undefined (sin filtro) si no sirve.
 */
export function parseLangParam(raw: string | undefined, markets: Market[]): string | undefined {
  if (!raw) return undefined;
  if (markets.some((m) => m.lang === raw)) return raw;
  return raw === NO_LANG && markets.length > 0 && !markets.some((m) => m.prefix === ROOT) ? NO_LANG : undefined;
}

const LANG_NAMES: Record<string, string> = {
  es: "Español", en: "Inglés", pt: "Portugués", fr: "Francés", de: "Alemán", it: "Italiano", nl: "Neerlandés", ca: "Catalán", gl: "Gallego",
  eu: "Vasco", zh: "Chino", ja: "Japonés", ko: "Coreano", ru: "Ruso", ar: "Árabe", he: "Hebreo", hi: "Hindi", tr: "Turco", pl: "Polaco",
  sv: "Sueco", da: "Danés", no: "Noruego", nb: "Noruego", fi: "Finés", el: "Griego", cs: "Checo", hu: "Húngaro", ro: "Rumano", uk: "Ucraniano",
  id: "Indonesio", vi: "Vietnamita", th: "Tailandés", fa: "Persa", bg: "Búlgaro", hr: "Croata", sr: "Serbio", sk: "Eslovaco", sl: "Esloveno",
  [NO_LANG]: "Sin idioma",
};

/** Nombre en español de un idioma; si no se conoce, el código en mayúsculas. */
export function langLabel(code: string): string {
  return LANG_NAMES[code] ?? code.toUpperCase();
}

/** Primer segmento de una ruta si parece un prefijo de idioma de 2 letras (`/es`, `/en-au`), o null. */
export function languageSegment(path: string): string | null {
  const m = /^\/([a-z]{2}(?:-[a-z0-9]{2,4})?)(?:\/|$)/i.exec(path);
  return m ? `/${m[1]!.toLowerCase()}` : null;
}
