import { pagePath } from "@/server/seo/urls";
import type { PageFacts } from "./seo-crawl-parse";
import { hasNoindex } from "./seo-crawl-parse";
import { classifyPath, type Market } from "./seo-markets";

/**
 * Reglas del rastreo técnico: de los hechos de cada página y del sitio a una lista de hallazgos con gravedad y evidencia.
 * Lógica pura, sin red ni base de datos. Cada hallazgo es único por (página, código); los del sitio usan `SITE` como página.
 */

export type Severity = "error" | "warning" | "info";
export type IssueGroup = "acceso" | "indexacion" | "canonica" | "contenido" | "idiomas" | "datos";

/** Página de los hallazgos que son del sitio entero, no de una ruta. */
export const SITE = "";

type CatalogEntry = { severity: Severity; group: IssueGroup; title: string; advice: string };
const c = (severity: Severity, group: IssueGroup, title: string, advice: string): CatalogEntry => ({ severity, group, title, advice });

/** Todos los hallazgos posibles: gravedad, qué es y qué hacer. Los códigos son estables: se comparan entre rastreos. */
export const ISSUE_CATALOG = {
  status_error: c("error", "acceso", "Página con error", "La página no responde bien (4xx, 5xx o sin respuesta). Corrígela, redirígela o quítala de los enlaces y del sitemap."),
  redirect_loop: c("error", "acceso", "Bucle de redirecciones", "Las redirecciones se llaman entre sí o pasan del límite. Apunta la primera directamente a su destino final."),
  redirect_chain: c("warning", "acceso", "Cadena de redirecciones", "Pasa por más de una redirección antes de llegar. Enlaza directamente al destino final."),
  http_not_redirected: c("warning", "acceso", "http no redirige a https", "La versión sin https responde sin redirigir. Redirige todo http a https."),
  broken_link: c("error", "acceso", "Enlace interno roto", "Hay páginas que enlazan a una dirección que da error. Corrige el enlace o restaura la página."),
  orphan_page: c("warning", "acceso", "Página huérfana", "Está en el sitemap pero ninguna página del sitio enlaza a ella. Enlázala desde donde corresponda o sácala del sitemap."),
  sitemap_url_noindex: c("error", "indexacion", "URL del sitemap con noindex", "El sitemap la ofrece pero la página pide no indexarse. Quita el noindex o sácala del sitemap."),
  sitemap_url_blocked: c("error", "indexacion", "URL del sitemap bloqueada por robots.txt", "El sitemap la ofrece pero robots.txt impide rastrearla. Permítela o sácala del sitemap."),
  sitemap_url_redirected: c("error", "indexacion", "URL del sitemap redirigida", "El sitemap debe listar solo direcciones finales. Sustituye la URL por la de destino."),
  robots_missing: c("warning", "indexacion", "Sin robots.txt", "El sitio no tiene robots.txt. Crea uno que, como mínimo, declare el sitemap."),
  robots_unreadable: c("warning", "indexacion", "robots.txt ilegible", "robots.txt no se pudo leer (error del servidor o sin respuesta). Los buscadores pueden tratar el sitio como bloqueado."),
  site_blocked: c("error", "indexacion", "Sitio bloqueado por robots.txt", "robots.txt prohíbe rastrear todo el sitio. Si no es lo que se quiere, quita el Disallow: /."),
  sitemap_missing: c("warning", "indexacion", "Sin sitemap", "No se encontró un sitemap. Publica uno y decláralo en robots.txt."),
  sitemap_unreadable: c("warning", "indexacion", "Sitemap ilegible", "El sitemap existe pero no se pudo leer o no es un XML de sitemap válido."),
  sitemap_not_in_robots: c("warning", "indexacion", "Sitemap no declarado en robots.txt", "Añade una línea Sitemap: con su dirección completa en robots.txt."),
  canonical_missing: c("warning", "canonica", "Sin canónica", "Declara <link rel=\"canonical\"> con la dirección de la propia página."),
  canonical_target_bad: c("error", "canonica", "Canónica a una página con error o redirigida", "La canónica debe apuntar a una página que responde 200 sin redirigir."),
  canonical_other_language: c("error", "canonica", "Canónica a otro idioma", "La canónica apunta a una página de otro idioma, lo que oculta esta de los buscadores. Debe apuntar a su propio idioma."),
  title_missing: c("error", "contenido", "Sin título", "Añade un <title> descriptivo y único."),
  title_length: c("warning", "contenido", "Título fuera de 30 a 60 caracteres", "Muy corto desaprovecha el espacio; muy largo se corta en los resultados."),
  title_duplicate: c("warning", "contenido", "Título repetido", "Varias páginas comparten el título. Haz que cada una tenga el suyo."),
  description_missing: c("warning", "contenido", "Sin meta description", "Añade una descripción de la página; es el texto que suele mostrarse en los resultados."),
  description_long: c("warning", "contenido", "Meta description de más de 160 caracteres", "Se cortará en los resultados. Resúmela."),
  description_duplicate: c("warning", "contenido", "Meta description repetida", "Varias páginas comparten la descripción. Haz que cada una tenga la suya."),
  h1_missing: c("warning", "contenido", "Sin h1", "Añade un encabezado h1 con el tema de la página."),
  h1_multiple: c("warning", "contenido", "Más de un h1", "Deja un solo h1 por página."),
  client_rendered: c("info", "contenido", "Contenido dibujado en el navegador", "La página llega casi vacía sin JavaScript, así que no se puede auditar su contenido. Conviene que el servidor entregue el HTML completo."),
  lang_missing: c("warning", "idiomas", "Sin atributo lang", "Declara el idioma en <html lang=\"…\">."),
  lang_mismatch: c("error", "idiomas", "lang distinto del idioma de la ruta", "El atributo lang no coincide con el idioma que indica el prefijo de la ruta."),
  hreflang_invalid_code: c("error", "idiomas", "Código hreflang inválido", "Usa un código de idioma (es), idioma y región (es-MX) o x-default."),
  hreflang_no_self: c("error", "idiomas", "hreflang sin enlace a sí misma", "Cada página debe incluirse a sí misma en su lista de hreflang."),
  hreflang_not_reciprocal: c("error", "idiomas", "hreflang no recíproco", "La página enlaza a una alternativa que no la enlaza de vuelta. Google ignora los hreflang que no son recíprocos."),
  hreflang_target_bad: c("error", "idiomas", "hreflang a una página inválida", "La alternativa da error, redirige, tiene noindex o declara otra canónica."),
  hreflang_wrong_language: c("error", "idiomas", "hreflang con el idioma equivocado", "El código declarado no coincide con el idioma de la ruta a la que apunta."),
  hreflang_absent: c("warning", "idiomas", "Idiomas declarados sin hreflang", "El proyecto tiene varios idiomas pero ninguna página declara hreflang."),
  x_default_missing: c("info", "idiomas", "Sin x-default", "Si hay una versión por defecto, declárala con hreflang=\"x-default\"."),
  language_without_pages: c("warning", "idiomas", "Idioma declarado sin páginas", "Hay idiomas declarados en el proyecto de los que no se rastreó ninguna página."),
  jsonld_invalid: c("error", "datos", "JSON-LD inválido", "Un bloque de datos estructurados no es JSON válido, así que se ignora."),
  jsonld_missing_props: c("warning", "datos", "Datos estructurados incompletos", "Un tipo conocido no trae sus propiedades principales."),
  jsonld_home_missing: c("info", "datos", "Portada sin Organization ni WebSite", "Conviene declarar la organización o el sitio con datos estructurados en la portada."),
} as const satisfies Record<string, CatalogEntry>;

export type IssueCode = keyof typeof ISSUE_CATALOG;
export const ISSUE_CODES = Object.keys(ISSUE_CATALOG) as IssueCode[];

export type Evidence = Record<string, string | number | boolean | string[]>;
export type Issue = { code: IssueCode; severity: Severity; page: string; lang: string | null; evidence: Evidence };

// ------------------------------------------------------------------ entrada

/** Una página tal como la dejó el rastreador. `path` es la dirección pedida; `finalPath`, a donde terminó si hubo redirección. */
export type CrawledPage = {
  path: string;
  /** Estado final tras seguir redirecciones; 0 si no respondió. */
  status: number;
  finalPath: string | null;
  hops: number;
  loop: boolean;
  contentType: string | null;
  /** Directrices de `X-Robots-Tag` ya filtradas para Google. */
  xRobots: string[];
  /** `robots.txt` la prohíbe: no se descargó. */
  blockedByRobots: boolean;
  inSitemap: boolean;
  /** Null si no es una página HTML correcta (error, PDF, bloqueada). */
  facts: PageFacts | null;
};

export type SiteFacts = {
  /** Hosts del proyecto, en minúsculas y sin `www.`. */
  hosts: string[];
  /** Estado de la descarga de `robots.txt` (0 = no respondió). */
  robots: { status: number; blocksAll: boolean };
  /** Sitemaps que se intentaron leer (los de robots.txt y `/sitemap.xml`). */
  sitemaps: Array<{ url: string; status: number; kind: "urlset" | "index" | "unknown" }>;
  sitemapDeclaredInRobots: boolean;
  /** Null si no se pudo comprobar. */
  httpRedirectsToHttps: boolean | null;
  /** El rastreo se cortó por páginas o tiempo: lo que depende de verlo todo no se evalúa. */
  truncated: boolean;
};

export type RulesInput = { pages: CrawledPage[]; site: SiteFacts; markets: Market[] };

// ------------------------------------------------------------------ utilidades

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
const primary = (lang: string) => lang.toLowerCase().split(/[-_]/)[0] ?? "";
const HREFLANG = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?)$/i;
const sample = <T>(list: T[], n = 5) => list.slice(0, n);

const CLIENT_RENDERED_TEXT = 80;

/** Páginas HTML correctas cuyos datos se pueden auditar. */
const auditable = (p: CrawledPage): p is CrawledPage & { facts: PageFacts } => p.status === 200 && p.facts !== null && !p.loop;
const clientRendered = (f: PageFacts) => f.textLength < CLIENT_RENDERED_TEXT && f.h1Count === 0;
const noindex = (p: CrawledPage & { facts: PageFacts }) => hasNoindex([...p.facts.robots, ...p.xRobots]);
const failing = (p: CrawledPage) => p.status === 0 || p.status >= 400 || p.loop;

/** Propiedades que cada tipo debe traer; `a|b` significa «cualquiera de las dos». */
const REQUIRED_PROPS: Record<string, string[]> = {
  Organization: ["name", "url"],
  WebSite: ["name", "url"],
  Article: ["headline", "author", "datePublished"],
  NewsArticle: ["headline", "author", "datePublished"],
  BlogPosting: ["headline", "author", "datePublished"],
  Product: ["name", "offers|review|aggregateRating"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  LocalBusiness: ["name", "address"],
};

const typeName = (t: string) => t.replace(/^https?:\/\/schema\.org\//i, "");

/** Páginas rastreadas que enlazan a cada ruta del sitio, sin contar los enlaces a sí misma ni a otros hosts. */
export function internalInlinks(pages: CrawledPage[], siteHosts: string[]): Map<string, Set<string>> {
  const hosts = new Set(siteHosts.map(bare));
  const inlinks = new Map<string, Set<string>>();
  for (const p of pages) {
    if (!auditable(p)) continue;
    for (const link of p.facts.links) {
      let host: string;
      try {
        host = bare(new URL(link).hostname);
      } catch {
        continue;
      }
      if (!hosts.has(host)) continue;
      const target = pagePath(link);
      if (target === p.path) continue;
      (inlinks.get(target) ?? inlinks.set(target, new Set()).get(target)!).add(p.path);
    }
  }
  return inlinks;
}

// ------------------------------------------------------------------ evaluación

/** Todos los hallazgos de un rastreo, ordenados por gravedad, código y página: el resultado es determinista. */
export function evaluate(input: RulesInput): Issue[] {
  const { pages, site, markets } = input;
  const issues: Issue[] = [];
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const langOf = (path: string) => (markets.length > 0 ? classifyPath(path, markets) : null);
  const add = (code: IssueCode, page: string, evidence: Evidence = {}) =>
    issues.push({ code, severity: ISSUE_CATALOG[code].severity, page, lang: page === SITE ? null : langOf(page), evidence });

  siteRules(site, add);

  const inlinks = internalInlinks(pages, site.hosts);

  // Enlaces rotos: un hallazgo por destino, con las páginas que lo enlazan. Una página rota que alguien enlaza se informa
  // solo así (lleva el estado y los orígenes); `status_error` queda para las que nadie enlaza, como las del sitemap.
  const brokenTargets = new Set<string>();
  for (const [target, sources] of inlinks) {
    const page = byPath.get(target);
    if (page && !page.blockedByRobots && failing(page)) {
      add("broken_link", target, { count: sources.size, from: sample([...sources].sort()), status: page.status, inSitemap: page.inSitemap });
      brokenTargets.add(target);
    }
  }
  for (const p of pages) pageStatusRules(p, add, brokenTargets);

  if (!site.truncated) {
    for (const p of pages) {
      if (p.inSitemap && p.path !== "/" && !failing(p) && !p.blockedByRobots && (inlinks.get(p.path)?.size ?? 0) === 0) add("orphan_page", p.path);
    }
  }

  const live = pages.filter(auditable);
  const indexable = live.filter((p) => !clientRendered(p.facts) && !noindex(p));
  for (const p of live) {
    if (clientRendered(p.facts)) {
      add("client_rendered", p.path, { text: p.facts.textLength });
      continue;
    }
    languageRules(p, markets, add);
    hreflangRules(p, byPath, markets, add);
    jsonLdRules(p, add);
  }
  for (const p of indexable) contentRules(p, byPath, markets, add);
  duplicateRules(indexable, "title", "title_duplicate", add);
  duplicateRules(indexable, "description", "description_duplicate", add);

  languageSiteRules(live, pages, site, markets, add);
  homeRules(byPath.get("/"), add);

  return sortIssues(issues);
}

type Add = (code: IssueCode, page: string, evidence?: Evidence) => void;

function siteRules(site: SiteFacts, add: Add): void {
  if (site.robots.status === 404) add("robots_missing", SITE);
  else if (site.robots.status !== 200) add("robots_unreadable", SITE, { status: site.robots.status });
  if (site.robots.blocksAll) add("site_blocked", SITE);

  const ok = site.sitemaps.filter((s) => s.status === 200 && s.kind !== "unknown");
  if (ok.length === 0) {
    const exists = site.sitemaps.some((s) => s.status === 200 || s.status >= 500 || s.status === 0);
    if (exists) add("sitemap_unreadable", SITE, { urls: sample(site.sitemaps.map((s) => s.url)) });
    else add("sitemap_missing", SITE);
  } else if (site.robots.status === 200 && !site.sitemapDeclaredInRobots) {
    add("sitemap_not_in_robots", SITE);
  }
  if (site.httpRedirectsToHttps === false) add("http_not_redirected", SITE);
}

function pageStatusRules(p: CrawledPage, add: Add, brokenTargets: Set<string>): void {
  if (p.blockedByRobots) {
    if (p.inSitemap) add("sitemap_url_blocked", p.path);
    return;
  }
  if (p.loop) {
    add("redirect_loop", p.path, { hops: p.hops });
    return;
  }
  if (p.status === 0 || p.status >= 400) {
    if (!brokenTargets.has(p.path)) add("status_error", p.path, { status: p.status, inSitemap: p.inSitemap });
    return;
  }
  if (p.hops > 1) add("redirect_chain", p.path, { hops: p.hops, to: p.finalPath ?? p.path });
  if (p.inSitemap && p.finalPath && p.finalPath !== p.path) add("sitemap_url_redirected", p.path, { to: p.finalPath });
  if (p.inSitemap && p.facts && hasNoindex([...p.facts.robots, ...p.xRobots])) add("sitemap_url_noindex", p.path);
  else if (p.inSitemap && !p.facts && hasNoindex(p.xRobots)) add("sitemap_url_noindex", p.path);
}

function contentRules(p: CrawledPage & { facts: PageFacts }, byPath: Map<string, CrawledPage>, markets: Market[], add: Add): void {
  const f = p.facts;
  if (!f.title) add("title_missing", p.path, { empty: f.title === "" });
  else if (f.title.length < 30 || f.title.length > 60) add("title_length", p.path, { length: f.title.length });
  if (!f.description) add("description_missing", p.path);
  else if (f.description.length > 160) add("description_long", p.path, { length: f.description.length });
  if (f.h1Count === 0) add("h1_missing", p.path);
  else if (f.h1Count > 1) add("h1_multiple", p.path, { count: f.h1Count });

  if (!f.canonical) {
    add("canonical_missing", p.path);
    return;
  }
  const target = pagePath(f.canonical);
  if (target === p.path) return;
  const dest = byPath.get(target);
  if (dest && (failing(dest) || dest.finalPath)) add("canonical_target_bad", p.path, { canonical: target, status: dest.status });
  if (markets.length > 0) {
    const mine = classifyPath(p.path, markets);
    const theirs = classifyPath(target, markets);
    if (mine && theirs && mine !== theirs) add("canonical_other_language", p.path, { canonical: target, expected: mine, found: theirs });
  }
}

function duplicateRules(pages: Array<CrawledPage & { facts: PageFacts }>, field: "title" | "description", code: IssueCode, add: Add): void {
  const groups = new Map<string, string[]>();
  for (const p of pages) {
    const value = p.facts[field]?.trim().toLowerCase();
    if (!value) continue;
    (groups.get(value) ?? groups.set(value, []).get(value)!).push(p.path);
  }
  for (const paths of groups.values()) {
    if (paths.length < 2) continue;
    for (const path of paths) add(code, path, { count: paths.length, also: sample(paths.filter((x) => x !== path).sort(), 3) });
  }
}

function languageRules(p: CrawledPage & { facts: PageFacts }, markets: Market[], add: Add): void {
  const lang = p.facts.htmlLang;
  if (!lang) {
    add("lang_missing", p.path);
    return;
  }
  const expected = markets.length > 0 ? classifyPath(p.path, markets) : null;
  if (expected && primary(lang) !== expected) add("lang_mismatch", p.path, { lang, expected });
}

function hreflangRules(p: CrawledPage & { facts: PageFacts }, byPath: Map<string, CrawledPage>, markets: Market[], add: Add): void {
  const entries = p.facts.hreflang;
  if (entries.length === 0) return;
  const invalid = entries.filter((e) => !HREFLANG.test(e.lang)).map((e) => e.lang);
  if (invalid.length > 0) add("hreflang_invalid_code", p.path, { codes: sample(invalid) });
  const valid = entries.filter((e) => HREFLANG.test(e.lang));
  if (!valid.some((e) => pagePath(e.href) === p.path)) add("hreflang_no_self", p.path);

  // Varios códigos (es, x-default) pueden apuntar a la misma página: cada una se informa una sola vez.
  const bad = new Set<string>();
  const nonReciprocal = new Set<string>();
  const wrongLang = new Set<string>();
  for (const e of valid) {
    const path = pagePath(e.href);
    if (path === p.path) continue;
    const target = byPath.get(path);
    if (!target || target.blockedByRobots) continue;
    const facts = target.facts;
    const canonicalElsewhere = facts?.canonical ? pagePath(facts.canonical) !== path : false;
    if (failing(target) || target.finalPath || (facts && (hasNoindex([...facts.robots, ...target.xRobots]) || canonicalElsewhere))) {
      bad.add(path);
      continue;
    }
    if (facts && !facts.hreflang.some((h) => pagePath(h.href) === p.path)) nonReciprocal.add(path);
    if (markets.length > 0 && e.lang.toLowerCase() !== "x-default") {
      const expected = classifyPath(path, markets);
      if (expected && primary(e.lang) !== expected) wrongLang.add(path);
    }
  }
  if (bad.size > 0) add("hreflang_target_bad", p.path, { targets: sample([...bad]) });
  if (nonReciprocal.size > 0) add("hreflang_not_reciprocal", p.path, { targets: sample([...nonReciprocal]) });
  if (wrongLang.size > 0) add("hreflang_wrong_language", p.path, { targets: sample([...wrongLang]) });
}

function jsonLdRules(p: CrawledPage & { facts: PageFacts }, add: Add): void {
  const { invalid, items } = p.facts.jsonLd;
  if (invalid > 0) add("jsonld_invalid", p.path, { blocks: invalid });
  const missing: string[] = [];
  for (const item of items) {
    const type = typeName(item.type);
    const required = REQUIRED_PROPS[type];
    if (!required) continue;
    const lacking = required.filter((req) => !req.split("|").some((prop) => item.props.includes(prop)));
    if (lacking.length > 0) missing.push(`${type}: ${lacking.join(", ")}`);
  }
  if (missing.length > 0) add("jsonld_missing_props", p.path, { missing: sample([...new Set(missing)]) });
}

function languageSiteRules(live: Array<CrawledPage & { facts: PageFacts }>, pages: CrawledPage[], site: SiteFacts, markets: Market[], add: Add): void {
  const withHreflang = live.filter((p) => p.facts.hreflang.length > 0);
  if (markets.length >= 2 && live.length > 0 && withHreflang.length === 0) add("hreflang_absent", SITE, { languages: markets.map((m) => m.lang) });
  if (withHreflang.length > 0 && !withHreflang.some((p) => p.facts.hreflang.some((h) => h.lang.toLowerCase() === "x-default"))) add("x_default_missing", SITE);
  if (markets.length > 0 && !site.truncated) {
    const seen = new Set(pages.filter((p) => !failing(p)).map((p) => classifyPath(p.path, markets)));
    const missing = markets.filter((m) => !seen.has(m.lang)).map((m) => m.lang);
    if (missing.length > 0) add("language_without_pages", SITE, { languages: missing });
  }
}

function homeRules(home: CrawledPage | undefined, add: Add): void {
  if (!home || !auditable(home) || clientRendered(home.facts)) return;
  const types = new Set(home.facts.jsonLd.items.map((i) => typeName(i.type)));
  if (!["Organization", "WebSite", "LocalBusiness"].some((t) => types.has(t))) add("jsonld_home_missing", SITE);
}

// ------------------------------------------------------------------ resultados

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.code.localeCompare(b.code) || a.page.localeCompare(b.page));
}

export type SeverityCounts = Record<Severity, number>;

export function summarize(issues: Array<{ severity: Severity }>): SeverityCounts {
  const out: SeverityCounts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) out[i.severity] += 1;
  return out;
}

/** Hallazgos agrupados por código, de más a menos grave y de más a menos páginas afectadas. */
export function groupByCode(issues: Issue[]): Array<{ code: IssueCode; severity: Severity; pages: number }> {
  const counts = new Map<IssueCode, number>();
  for (const i of issues) counts.set(i.code, (counts.get(i.code) ?? 0) + 1);
  return [...counts]
    .map(([code, pages]) => ({ code, severity: ISSUE_CATALOG[code].severity, pages }))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.pages - a.pages || a.code.localeCompare(b.code));
}

/**
 * Deja los hallazgos de un idioma. `null` = todos. «none» = páginas sin idioma (las del sitio entero no tienen idioma y
 * solo salen cuando no se filtra).
 */
export function byLanguage<T extends { page: string; lang: string | null }>(issues: T[], lang: string | null): T[] {
  if (lang === null) return issues;
  if (lang === "none") return issues.filter((i) => i.lang === null && i.page !== SITE);
  return issues.filter((i) => i.lang === lang);
}

export type IssueKey = { page: string; code: string };
const keyOf = (i: IssueKey) => `${i.code}|${i.page}`;

/** Compara dos rastreos por (código, página): nuevos, que persisten y resueltos. */
export function diffIssues<T extends IssueKey>(previous: T[], current: T[]): { added: T[]; persistent: T[]; resolved: T[] } {
  const before = new Set(previous.map(keyOf));
  const now = new Set(current.map(keyOf));
  return {
    added: current.filter((i) => !before.has(keyOf(i))),
    persistent: current.filter((i) => before.has(keyOf(i))),
    resolved: previous.filter((i) => !now.has(keyOf(i))),
  };
}
