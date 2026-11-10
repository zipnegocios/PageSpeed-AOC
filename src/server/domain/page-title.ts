/**
 * Título legible de una página para el cliente (no su ruta). Prioridad: la etiqueta que puso el administrador, el título
 * del último rastreo (sin el sufijo de marca) y, de respaldo, el último segmento de la ruta. Lógica pura.
 */

export const HOME_TITLE = "Inicio";
const MAX_TITLE = 60;
/** « | », « - », « – », « — » o « · » con espacios: el separador entre el título de la página y la marca del sitio. */
const SEPARATOR = /\s+[|–—·-]\s+/;

const clip = (s: string) => (s.length > MAX_TITLE ? `${s.slice(0, MAX_TITLE - 1).trimEnd()}…` : s);

/** «consultoria-legal» → «Consultoria legal». Sin tildes: por eso la etiqueta manual manda. */
export function humanizeSegment(segment: string): string {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    /* un % suelto: se deja tal cual */
  }
  s = s.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  return s === "" ? segment : s.charAt(0).toLocaleUpperCase("es") + s.slice(1);
}

/** Título de respaldo según la ruta: «/» → «Inicio»; si no, el último segmento humanizado. */
export function pathTitle(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length === 0 ? HOME_TITLE : humanizeSegment(segments[segments.length - 1]!);
}

/**
 * La marca que se repite al final de los títulos («… | Tecnostar»): el último tramo compartido por al menos la mitad de los
 * títulos con separador (mínimo dos), o el nombre del sitio si coincide. null si no hay ninguna.
 */
export function brandSuffix(titles: string[], siteName?: string): string | null {
  const last = (t: string) => {
    const parts = t.split(SEPARATOR);
    return parts.length > 1 ? parts[parts.length - 1]!.trim() : null;
  };
  const counts = new Map<string, number>();
  for (const t of titles) {
    const s = last(t);
    if (s) counts.set(s.toLowerCase(), (counts.get(s.toLowerCase()) ?? 0) + 1);
  }
  const name = siteName?.trim().toLowerCase();
  let best: string | null = null;
  let bestN = 0;
  for (const [s, n] of counts) {
    const shared = n >= 2 && n >= Math.ceil(titles.length / 2);
    if ((shared || (name && s === name)) && n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return best;
}

/** El título sin su sufijo de marca; si no queda nada, el original. */
export function cleanTitle(title: string, suffix: string | null): string {
  const t = title.trim().replace(/\s+/g, " ");
  if (!suffix) return t;
  const parts = t.split(SEPARATOR);
  if (parts.length > 1 && parts[parts.length - 1]!.trim().toLowerCase() === suffix) {
    const rest = parts.slice(0, -1).join(" - ").trim();
    if (rest) return rest;
  }
  return t;
}

export type TitleSource = {
  path: string;
  /** Etiqueta del administrador. */
  label: string | null;
  /** Título de la página en el último rastreo, ya filtrado a páginas fiables (200, sin redirección, sin sesión). */
  crawlTitle: string | null;
};

/**
 * El título de cada página por su ruta. `allCrawlTitles` son los títulos de todo el rastreo: con ellos se reconoce la marca
 * repetida aunque aquí se pidan pocas páginas (con una sola no habría repetición que detectar).
 */
export function resolveTitles(pages: TitleSource[], siteName?: string, allCrawlTitles?: string[]): Map<string, string> {
  const suffix = brandSuffix(allCrawlTitles ?? pages.flatMap((p) => (p.path !== "/" && p.crawlTitle ? [p.crawlTitle] : [])), siteName);
  const out = new Map<string, string>();
  for (const p of pages) {
    const label = p.label?.trim();
    if (label) out.set(p.path, clip(label));
    else if (p.path !== "/" && p.crawlTitle?.trim()) out.set(p.path, clip(cleanTitle(p.crawlTitle, suffix)));
    else out.set(p.path, pathTitle(p.path));
  }
  return out;
}
