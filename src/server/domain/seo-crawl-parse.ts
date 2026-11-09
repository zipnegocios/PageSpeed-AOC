import { Parser } from "htmlparser2";

/**
 * Lee el HTML de una página y extrae solo hechos técnicos de SEO. Lógica pura: el HTML se descarta al terminar y nunca
 * se guarda. El parser es tolerante (comentarios, atributos sin comillas, etiquetas sin cerrar, HTML cortado).
 */

export type JsonLdItem = { type: string; props: string[] };

export type PageFacts = {
  /** Texto del primer `<title>` con los espacios colapsados; null si no hay etiqueta. Vacío si la etiqueta no tiene texto. */
  title: string | null;
  description: string | null;
  h1Count: number;
  /** Dirección absoluta de la canónica; null si falta o no es una dirección válida. */
  canonical: string | null;
  /** Directrices de `<meta name="robots">` y `<meta name="googlebot">`, en minúsculas. */
  robots: string[];
  htmlLang: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  /** Enlaces `<a href>` seguibles (sin `rel=nofollow`), absolutos y sin ancla; solo http y https. */
  links: string[];
  jsonLd: { invalid: number; items: JsonLdItem[] };
  /** Caracteres de texto visible en `<body>`, sin scripts ni estilos: sirve para detectar cascarones de JavaScript. */
  textLength: number;
};

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function resolve(href: string | undefined, base: string): string | null {
  if (!href) return null;
  const value = href.trim();
  if (value === "" || value.startsWith("#")) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function collectTypes(node: unknown, out: JsonLdItem[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out, depth + 1));
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const raw = obj["@type"];
  const types = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
  for (const type of types) out.push({ type, props: Object.keys(obj).filter((k) => !k.startsWith("@")) });
  for (const value of Object.values(obj)) collectTypes(value, out, depth + 1);
}

const SKIPPED_TEXT = new Set(["script", "style", "noscript", "template", "svg"]);

/** Hechos de una página. `pageUrl` resuelve los enlaces relativos (y se respeta `<base href>`). */
export function parseHtml(html: string, pageUrl: string): PageFacts {
  let base = pageUrl;
  let baseSet = false;
  let title: string | null = null;
  let titleDone = false;
  let inTitle = false;
  let titleText = "";
  let description: string | null = null;
  let h1Count = 0;
  let canonical: string | null = null;
  const robots: string[] = [];
  let htmlLang: string | null = null;
  const hreflang: PageFacts["hreflang"] = [];
  const links = new Set<string>();
  const jsonItems: JsonLdItem[] = [];
  let jsonInvalid = 0;
  let inLd = false;
  let ldText = "";
  let inBody = false;
  let skip = 0;
  let textLength = 0;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "html" && htmlLang === null && attrs.lang !== undefined) htmlLang = attrs.lang.trim() || null;
        else if (name === "base" && !baseSet) {
          const resolved = resolve(attrs.href, pageUrl);
          if (resolved) base = resolved;
          baseSet = true;
        } else if (name === "title" && !titleDone) {
          inTitle = true;
          titleText = "";
        } else if (name === "meta") {
          const key = (attrs.name ?? "").toLowerCase();
          const content = attrs.content;
          if (key === "description" && description === null && content !== undefined) description = collapse(content);
          if ((key === "robots" || key === "googlebot") && content) robots.push(...content.toLowerCase().split(",").map((d) => d.trim()).filter(Boolean));
        } else if (name === "link") {
          const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
          if (rel.includes("canonical") && canonical === null) canonical = resolve(attrs.href, base);
          else if (rel.includes("alternate") && attrs.hreflang && attrs.href) {
            const href = resolve(attrs.href, base);
            if (href) hreflang.push({ lang: attrs.hreflang.trim(), href });
          }
        } else if (name === "a") {
          const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
          const href = resolve(attrs.href, base);
          if (href && !rel.includes("nofollow")) links.add(href);
        } else if (name === "h1") {
          h1Count += 1;
        } else if (name === "script" && (attrs.type ?? "").toLowerCase().trim() === "application/ld+json") {
          inLd = true;
          ldText = "";
        } else if (name === "body") {
          inBody = true;
        }
        if (SKIPPED_TEXT.has(name)) skip += 1;
      },
      ontext(text) {
        if (inTitle) titleText += text;
        else if (inLd) ldText += text;
        else if (inBody && skip === 0) textLength += collapse(text).length;
      },
      onclosetag(name) {
        if (name === "title" && inTitle) {
          inTitle = false;
          titleDone = true;
          title = collapse(titleText);
        }
        if (name === "script" && inLd) {
          inLd = false;
          try {
            collectTypes(JSON.parse(ldText), jsonItems);
          } catch {
            jsonInvalid += 1;
          }
        }
        if (SKIPPED_TEXT.has(name) && skip > 0) skip -= 1;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  // Un `<title>` que el HTML cortado dejó sin cerrar cuenta con lo leído hasta ahí.
  if (inTitle && !titleDone) title = collapse(titleText);

  return { title, description, h1Count, canonical, robots, htmlLang, hreflang, links: [...links], jsonLd: { invalid: jsonInvalid, items: jsonItems }, textLength };
}

/** ¿Las directrices piden no indexar? `none` equivale a `noindex, nofollow`. */
export function hasNoindex(directives: string[]): boolean {
  return directives.some((d) => d === "noindex" || d === "none");
}

const KNOWN_DIRECTIVES = new Set(["all", "none", "noindex", "nofollow", "noarchive", "nosnippet", "noimageindex", "notranslate", "indexifembedded", "unavailable_after", "max-snippet", "max-image-preview", "max-video-preview"]);

/**
 * Directrices de la cabecera `X-Robots-Tag` que valen para Google: las sin agente y las de «googlebot». Una directriz con
 * agente (`otherbot: noindex`) cambia el agente de las siguientes hasta que aparezca otro; varias cabeceras llegan unidas por comas.
 */
export function parseRobotsHeader(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  let agent: string | null = null;
  for (const part of value.split(",")) {
    let text = part.trim().toLowerCase();
    const m = /^([a-z0-9-]+)\s*:\s*(.*)$/.exec(text);
    if (m && !KNOWN_DIRECTIVES.has(m[1]!)) {
      agent = m[1]!;
      text = m[2]!.trim();
    }
    if (text && (agent === null || agent === "googlebot" || agent === "all")) out.push(text);
  }
  return out;
}
