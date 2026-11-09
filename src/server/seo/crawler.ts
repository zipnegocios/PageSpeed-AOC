import { parseHtml, parseRobotsHeader } from "@/server/domain/seo-crawl-parse";
import type { CrawledPage, SiteFacts } from "@/server/domain/seo-crawl-rules";
import { parseRobots, parseSitemapDocument, SEO_USER_AGENT } from "@/server/domain/seo-robots";
import { fetchHop, isHostAllowed, normalizeHost, type HopResponse } from "@/server/domain/url-guard";
import { pagePath } from "./urls";

/**
 * Rastreador de un sitio: descarga `robots.txt`, los sitemaps y las páginas, y devuelve los hechos que evalúan las reglas.
 * No toca la base de datos. Lee HTML sin ejecutar JavaScript, respeta `robots.txt`, se identifica y limita su ritmo. La
 * descarga y la espera se inyectan: las pruebas corren sin red ni relojes reales.
 */

export type CrawlLimits = {
  maxPages: number;
  maxDepth: number;
  /** Peticiones simultáneas. */
  concurrency: number;
  /** Pausa de cada petición tras terminar, antes de pedir otra. */
  pauseMs: number;
  pageTimeoutMs: number;
  /** HTML que se analiza por página; el resto se ignora. */
  maxHtmlBytes: number;
  maxRedirects: number;
  /** Duración total; pasado el plazo el rastreo termina como parcial. */
  maxDurationMs: number;
  /** Tras estas peticiones se evalúa si el sitio nos está bloqueando… */
  blockCheckAfter: number;
  /** …con esta fracción de respuestas 403 o 429. */
  blockRatio: number;
  maxSitemapUrls: number;
  maxChildSitemaps: number;
};

export const DEFAULT_LIMITS: CrawlLimits = {
  maxPages: 300,
  maxDepth: 3,
  concurrency: 2,
  pauseMs: 400,
  pageTimeoutMs: 10_000,
  maxHtmlBytes: 1_000_000,
  maxRedirects: 5,
  maxDurationMs: 20 * 60_000,
  blockCheckAfter: 20,
  blockRatio: 0.3,
  maxSitemapUrls: 5000,
  maxChildSitemaps: 20,
};

/** Tope que ningún proyecto puede superar aunque pida más. */
export const HARD_MAX_PAGES = 1000;

export type FetchHopFn = (url: string, opts: { maxBytes: number; timeoutMs: number; truncate: boolean; accept: string }) => Promise<HopResponse>;

export type CrawlOutcome =
  /** Terminó de recorrer lo que encontró. */
  | "complete"
  /** Se cortó por páginas o por tiempo. */
  | "partial"
  /** `robots.txt` prohíbe todo el sitio al rastreador. */
  | "site_blocked"
  /** El sitio responde 403 o 429 de forma masiva: un cortafuegos lo frena. */
  | "blocked_by_site"
  /** La portada pide sesión (401). */
  | "login_required"
  /** La portada no responde. */
  | "unreachable";

export type CrawlResult = {
  outcome: CrawlOutcome;
  /** Por qué se cortó, si se cortó: `pages`, `time` o `blocked`. */
  truncatedBy: "pages" | "time" | null;
  /** Mensaje legible de la causa cuando el resultado no es completo. */
  detail: string | null;
  pages: CrawledPage[];
  site: SiteFacts;
  /** Páginas distintas que se llegaron a conocer. */
  discovered: number;
  /** Peticiones HTTP hechas, redirecciones incluidas. */
  requests: number;
};

export type CrawlOptions = {
  baseUrl: string;
  allowedHosts: string[];
  /** Sitemap del proyecto; si falta se prueba `/sitemap.xml`. */
  sitemapUrl?: string | null;
  /** Rutas extra que sembrar (por ejemplo, las ya registradas en el proyecto). */
  seedPaths?: string[];
  limits?: Partial<CrawlLimits>;
  /** Solo pruebas: sustituye la descarga. Por defecto usa `fetchHop` con las salvaguardas anti-SSRF. */
  fetchHop?: FetchHopFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Solo pruebas: permite conectar a direcciones privadas. */
  allowPrivate?: boolean;
};

const ASSET = /\.(?:pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|zip|gz|mp4|webm|mp3|woff2?|ttf|eot|docx?|xlsx?|pptx?)$/i;
const isHtml = (contentType: string) => /text\/html|application\/xhtml\+xml/i.test(contentType);
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Followed = {
  status: number;
  /** Última URL a la que se llegó. */
  finalUrl: string;
  hops: number;
  loop: boolean;
  hop: HopResponse | null;
  /** La cadena salió del sitio: no se siguió. */
  external: boolean;
  failed: boolean;
};

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const limits: CrawlLimits = { ...DEFAULT_LIMITS, ...options.limits };
  limits.maxPages = Math.min(limits.maxPages, HARD_MAX_PAGES);
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const started = now();
  const base = new URL(options.baseUrl);
  const origin = base.origin;
  const allowedHosts = options.allowedHosts;
  const hosts = [...new Set(allowedHosts.filter((h) => !h.startsWith("*.")).map((h) => normalizeHost(h).replace(/^www\./, "")))];

  const hopFn: FetchHopFn =
    options.fetchHop ??
    ((url, o) => fetchHop(url, { allowedHosts, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes, truncate: o.truncate, accept: o.accept, userAgent: SEO_USER_AGENT, allowPrivate: options.allowPrivate }));

  let requests = 0;
  let blocked = 0;
  let delayMs = limits.pauseMs;

  /** Una descarga, sin seguir redirecciones; los errores de red se vuelven estado 0. */
  const once = async (url: string, o: { maxBytes: number; accept: string }): Promise<HopResponse | null> => {
    requests += 1;
    try {
      const hop = await hopFn(url, { maxBytes: o.maxBytes, timeoutMs: limits.pageTimeoutMs, truncate: true, accept: o.accept });
      if (hop.status === 403 || hop.status === 429) blocked += 1;
      return hop;
    } catch {
      // Un host fuera de la lista, una IP privada, un tiempo agotado o un corte de red: la página «no respondió».
      return null;
    }
  };

  /** Sigue las redirecciones una a una, midiendo los saltos y deteniéndose si el destino sale del sitio. */
  const follow = async (startUrl: string, accept: string, maxBytes = limits.maxHtmlBytes): Promise<Followed> => {
    const seen = new Set<string>();
    let url = startUrl;
    for (let hops = 0; ; hops++) {
      if (seen.has(url) || hops > limits.maxRedirects) return { status: 0, finalUrl: url, hops, loop: true, hop: null, external: false, failed: false };
      seen.add(url);
      if (hops > 0) await sleep(delayMs);
      const hop = await once(url, { maxBytes, accept });
      if (!hop) return { status: 0, finalUrl: url, hops, loop: false, hop: null, external: false, failed: true };
      if (hop.status >= 300 && hop.status < 400 && hop.location) {
        let next: URL;
        try {
          next = new URL(hop.location, url);
        } catch {
          return { status: hop.status, finalUrl: url, hops, loop: false, hop, external: false, failed: false };
        }
        if (!/^https?:$/.test(next.protocol)) return { status: hop.status, finalUrl: url, hops, loop: false, hop, external: false, failed: false };
        if (!isHostAllowed(next.hostname, allowedHosts)) return { status: hop.status, finalUrl: url, hops: hops + 1, loop: false, hop, external: true, failed: false };
        url = next.toString();
        continue;
      }
      return { status: hop.status, finalUrl: url, hops, loop: false, hop, external: false, failed: false };
    }
  };

  const site: SiteFacts = {
    hosts,
    robots: { status: 0, blocksAll: false },
    sitemaps: [],
    sitemapDeclaredInRobots: false,
    httpRedirectsToHttps: null,
    truncated: false,
  };
  const result = (outcome: CrawlOutcome, detail: string | null, pages: CrawledPage[], discovered: number, truncatedBy: CrawlResult["truncatedBy"] = null): CrawlResult => ({
    outcome,
    truncatedBy,
    detail,
    pages: pages.sort((a, b) => a.path.localeCompare(b.path)),
    site: { ...site, truncated: truncatedBy !== null },
    discovered,
    requests,
  });

  if (!isHostAllowed(base.hostname, allowedHosts)) {
    return result("unreachable", `La dirección del proyecto (${normalizeHost(base.hostname)}) no está entre sus hosts permitidos, así que no se puede rastrear.`, [], 0);
  }

  // ------------------------------------------------------------ robots.txt
  const robotsFollow = await follow(`${origin}/robots.txt`, "text/plain,*/*;q=0.1", 500_000);
  site.robots.status = robotsFollow.failed || robotsFollow.loop ? 0 : robotsFollow.status;
  const robotsText = robotsFollow.hop && robotsFollow.status === 200 ? robotsFollow.hop.text : null;
  const robots = parseRobots(origin, robotsText);
  site.robots.blocksAll = robots.blocksAll;
  if (robots.crawlDelayMs !== null) delayMs = Math.max(delayMs, robots.crawlDelayMs);
  if (robots.blocksAll) return result("site_blocked", "robots.txt prohíbe rastrear todo el sitio al agente del rastreador.", [], 0);

  // ------------------------------------------------------------ sitemaps
  const sitemapPaths: string[] = [];
  const inSitemap = new Set<string>();
  const candidates = [...new Set([options.sitemapUrl ?? `${origin}/sitemap.xml`, ...robots.sitemaps])];
  const fetched = new Set<string>();
  const queueSitemaps = [...candidates];
  const robotsDeclared = new Set(robots.sitemaps);
  let children = 0;
  while (queueSitemaps.length > 0) {
    const url = queueSitemaps.shift()!;
    if (fetched.has(url)) continue;
    fetched.add(url);
    await sleep(delayMs);
    const res = await follow(url, "application/xml,text/xml,*/*;q=0.1", 5_000_000);
    const text = res.hop && res.status === 200 ? res.hop.text : "";
    const doc = parseSitemapDocument(text, limits.maxSitemapUrls);
    const ok = res.status === 200 && !res.failed && !res.loop;
    site.sitemaps.push({ url, status: res.failed || res.loop ? 0 : res.status, kind: ok ? doc.kind : "unknown" });
    if (!ok) continue;
    if (robotsDeclared.has(url) && doc.kind !== "unknown") site.sitemapDeclaredInRobots = true;
    for (const child of doc.children) {
      if (children < limits.maxChildSitemaps && isHostAllowed(safeHost(child), allowedHosts)) {
        children += 1;
        queueSitemaps.push(child);
      }
    }
    for (const entry of doc.entries) {
      if (sitemapPaths.length >= limits.maxSitemapUrls) break;
      if (!isHostAllowed(safeHost(entry.loc), allowedHosts)) continue;
      const path = pagePath(entry.loc);
      if (!inSitemap.has(path)) {
        inSitemap.add(path);
        sitemapPaths.push(entry.loc);
      }
    }
  }

  // ------------------------------------------------------------ http → https
  if (base.protocol === "https:") {
    await sleep(delayMs);
    const plain = await once(`http://${base.host}/`, { maxBytes: 1, accept: "text/html,*/*;q=0.1" });
    if (plain) {
      if (plain.status >= 300 && plain.status < 400 && plain.location) site.httpRedirectsToHttps = /^https:/i.test(new URL(plain.location, `http://${base.host}/`).toString());
      else if (plain.status === 200) site.httpRedirectsToHttps = false;
    }
  }

  // ------------------------------------------------------------ páginas
  type Item = { url: string; depth: number };
  const known = new Map<string, string>();
  const queue: Item[] = [];
  const enqueue = (url: string, depth: number) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!/^https?:$/.test(parsed.protocol) || !isHostAllowed(parsed.hostname, allowedHosts)) return;
    if (ASSET.test(parsed.pathname)) return;
    const path = pagePath(url);
    if (known.has(path)) return;
    known.set(path, url);
    queue.push({ url, depth });
  };
  enqueue(origin + "/", 0);
  enqueue(options.baseUrl, 0);
  for (const loc of sitemapPaths) enqueue(loc, 0);
  for (const path of options.seedPaths ?? []) enqueue(new URL(path, origin).toString(), 0);

  const pages: CrawledPage[] = [];
  let claimed = 0;
  let stoppedBy: "pages" | "time" | "blocked" | null = null;

  const record = (path: string, depth: number, f: Followed): void => {
    const hop = f.hop;
    const finalPath = pagePath(f.finalUrl) !== path ? pagePath(f.finalUrl) : null;
    const html = hop !== null && f.status === 200 && isHtml(hop.contentType);
    // Una página redirigida no se juzga por lo que dice su destino (saldría duplicada): el destino se rastrea aparte.
    const facts = html && finalPath === null ? parseHtml(hop.text, f.finalUrl) : null;
    pages.push({
      path,
      status: f.failed ? 0 : f.status,
      finalPath: f.external ? null : finalPath,
      hops: f.hops,
      loop: f.loop,
      contentType: hop?.contentType || null,
      xRobots: parseRobotsHeader(hop?.xRobotsTag),
      blockedByRobots: false,
      inSitemap: inSitemap.has(path),
      facts,
    });
    if (finalPath && !f.external) enqueue(f.finalUrl, depth);
    if (facts && depth < limits.maxDepth) for (const link of facts.links) enqueue(link, depth + 1);
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stoppedBy) return;
      const item = queue.shift();
      if (!item) return;
      if (now() - started > limits.maxDurationMs) {
        queue.unshift(item);
        stoppedBy = "time";
        return;
      }
      if (claimed >= limits.maxPages) {
        queue.unshift(item);
        stoppedBy = "pages";
        return;
      }
      claimed += 1;
      const path = pagePath(item.url);
      if (!robots.isAllowed(item.url)) {
        pages.push({ path, status: 0, finalPath: null, hops: 0, loop: false, contentType: null, xRobots: [], blockedByRobots: true, inSitemap: inSitemap.has(path), facts: null });
        continue;
      }
      const followed = await follow(item.url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
      record(path, item.depth, followed);

      if (requests >= limits.blockCheckAfter && blocked / requests >= limits.blockRatio) {
        stoppedBy = "blocked";
        return;
      }
      await sleep(delayMs);
    }
  };

  // La portada va sola primero: si pide sesión, no responde o nos bloquea, no tiene sentido seguir.
  const first = queue.shift();
  if (!first) return result("unreachable", "No hay ninguna dirección que rastrear.", [], known.size);
  claimed += 1;
  const path = pagePath(first.url);
  const followed = await follow(first.url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
  if (followed.status === 401) return result("login_required", "El sitio pide iniciar sesión (401): el rastreo no usa credenciales y no puede auditarlo.", [], known.size);
  if (followed.failed || followed.loop || followed.status === 0) return result("unreachable", "La portada del sitio no responde.", [], known.size);
  if (followed.status === 403 || followed.status === 429) return result("blocked_by_site", "El sitio rechaza al rastreador (403 o 429), probablemente un cortafuegos. Permite el agente PageSpeedAOC-SEO para poder auditarlo.", [], known.size);
  record(path, first.depth, followed);
  await sleep(delayMs);

  await Promise.all(Array.from({ length: Math.max(1, limits.concurrency) }, () => worker()));

  if (stoppedBy === "blocked") {
    return result("blocked_by_site", "El sitio respondió 403 o 429 a una parte grande de las peticiones: un cortafuegos está frenando al rastreador. Permite el agente PageSpeedAOC-SEO.", pages, known.size);
  }
  if (stoppedBy === "time") return result("partial", "Se alcanzó el tiempo máximo del rastreo; los resultados son parciales.", pages, known.size, "time");
  if (stoppedBy === "pages" || queue.length > 0) return result("partial", `Se alcanzó el máximo de ${limits.maxPages} páginas; los resultados son parciales.`, pages, known.size, "pages");
  return result("complete", null, pages, known.size);
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
