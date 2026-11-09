import { createHash } from "node:crypto";
import { AI_REFERRER_HOSTS } from "./cloudflare";
import type { Market } from "./lang";

/**
 * Saneado de la salida del piloto para usarla como fixtures en pruebas de la fase 1 sin exponer datos del cliente.
 * Son funciones puras y deterministas: la misma entrada (y la misma sal) da siempre la misma salida.
 * La forma de cada JSON se conserva; cambian los valores sensibles (hosts, rutas, consultas, textos, ID) y se perturban las cifras.
 */

export const FICTIONAL_HOST = "example.com";
export const FICTIONAL_GSC_SITE = `sc-domain:${FICTIONAL_HOST}`;
export const FICTIONAL_GA4_PROPERTY = "100000001";
export const FICTIONAL_CF_ZONE = "f1e2d3c4b5a69788796a5b4c3d2e1f00";
export const DEFAULT_SALT = "spike-seo-fixtures-v1";

/** Salidas del piloto que se pueden sanear. */
export const FIXTURE_NAMES = ["gsc-search", "gsc-queries", "gsc-inspection", "gsc-sitemaps", "ga4-report", "ga4-ai", "cf-summary", "crawl-pages", "probe-runs"] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export type SanitizeOptions = {
  /** Prefijos de idioma de `SPIKE_LANGS`: se conservan tal cual en las rutas. */
  markets?: Market[];
  /** Sal de la seudonimización. Cámbiala si quieres que los tokens no coincidan con los de otro lote. */
  salt?: string;
  /** ID de la propiedad de GA4 y zona de Cloudflare reales: se sustituyen por valores ficticios dondequiera que aparezcan. */
  ga4Property?: string;
  cfZone?: string;
  /** Hosts e identificadores reales que no deben aparecer en el resultado (los comprueba `assertNoLeaks`). */
  known?: string[];
};

// ---------- hash y tokens ----------

function hex(kind: string, text: string, salt: string): string {
  return createHash("sha256").update(`${salt}\u0000${kind}\u0000${text}`).digest("hex");
}

/** Seis caracteres hexadecimales estables para un texto. */
export const token6 = (kind: string, text: string, salt: string = DEFAULT_SALT): string => hex(kind, text, salt).slice(0, 6);

/** Número estable en [0, 1) para un texto. */
function unit(kind: string, text: string, salt: string): number {
  return Number.parseInt(hex(kind, text, salt).slice(0, 8), 16) / 0x1_0000_0000;
}

/** Texto libre → `texto-1a2b3c`. El vacío se queda vacío. */
export const pseudoText = (text: string, salt: string = DEFAULT_SALT, prefix = "texto"): string => (text === "" ? "" : `${prefix}-${token6(prefix, text, salt)}`);

/** Dominio (sin ruta) → `d-1a2b3c.example.net`. Los referidos de asistentes de IA, que son públicos, se conservan. */
export function pseudoDomain(host: string, salt: string = DEFAULT_SALT): string {
  const h = host.toLowerCase();
  if (AI_REFERRER_HOSTS.some((a) => h === a || h.endsWith(`.${a}`))) return host;
  return `d-${token6("dominio", h, salt)}.example.net`;
}

// ---------- rutas y URL ----------

const KEEP_SEGMENTS = new Set(["index.html", "index.htm"]);

function pseudoSegment(segment: string, salt: string): string {
  if (segment === "" || KEEP_SEGMENTS.has(segment)) return segment;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Una secuencia % inválida se usa tal cual.
  }
  // Se decodifica antes de seudonimizar para que GSC (codificada) y GA4 (decodificada) den el mismo token.
  return `p-${token6("segmento", decoded, salt)}`;
}

/**
 * Ruta con posible `?consulta` y `#ancla`: conserva el prefijo de idioma configurado y las barras, y sustituye cada segmento
 * por `p-xxxxxx`. Los parámetros y el ancla se reducen a un token (los valores pueden ser datos del cliente).
 */
export function pseudoRoute(input: string, markets: Market[] = [], salt: string = DEFAULT_SALT): string {
  const m = /^([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/.exec(input);
  const path = m?.[1] ?? input;
  const query = m?.[2];
  const fragment = m?.[3];

  let keep = "";
  let rest = path;
  for (const market of [...markets].sort((a, b) => b.prefix.length - a.prefix.length)) {
    if (path === market.prefix || path.startsWith(`${market.prefix}/`)) {
      keep = market.prefix;
      rest = path.slice(market.prefix.length);
      break;
    }
  }
  const body = rest
    .split("/")
    .map((s) => pseudoSegment(s, salt))
    .join("/");
  return `${keep}${body}${query ? `?x=${token6("consulta-url", query, salt)}` : ""}${fragment ? `#f-${token6("ancla", fragment, salt)}` : ""}`;
}

const URL_RE = /^(https?):\/\/([^/?#]*)([\s\S]*)$/i;

/** ¿Parece una URL absoluta http(s) o una ruta que empieza por `/`? */
export const isUrlLike = (s: string): boolean => URL_RE.test(s) || /^\/[^\s]*$/.test(s);

/** URL absoluta (host → example.com) o ruta, seudonimizada. null si el texto no es ninguna de las dos. */
export function pseudoUrl(input: string, markets: Market[] = [], salt: string = DEFAULT_SALT): string | null {
  const m = URL_RE.exec(input);
  if (m) return `${(m[1] ?? "https").toLowerCase()}://${FICTIONAL_HOST}${pseudoRoute(m[3] ?? "", markets, salt)}`;
  if (/^\/[^\s]*$/.test(input)) return pseudoRoute(input, markets, salt);
  return null;
}

/** Propiedad de GSC: `sc-domain:dominio` o una URL con prefijo. */
export function pseudoSite(site: string, markets: Market[] = [], salt: string = DEFAULT_SALT): string {
  if (site.startsWith("sc-domain:")) return FICTIONAL_GSC_SITE;
  return pseudoUrl(site, markets, salt) ?? FICTIONAL_GSC_SITE;
}

// ---------- cifras ----------

/**
 * Perturba un conteo de forma determinista (±15 %) sin salir de su orden de magnitud: 0 sigue siendo 0 y 1 a 9, 10 a 99,
 * 100 a 999… siguen en su tramo. `key` identifica la cifra (fila y métrica) para que cada una cambie distinto.
 */
export function perturbCount(n: number, key: string, salt: string = DEFAULT_SALT): number {
  if (!Number.isFinite(n) || n < 1) return n;
  const v = Math.round(n);
  const factor = 0.85 + 0.3 * unit("cifra", key, salt);
  const lo = 10 ** Math.floor(Math.log10(v));
  return Math.min(lo * 10 - 1, Math.max(lo, Math.round(v * factor)));
}

// ---------- reglas de claves y valores ----------

/** Claves cuyo valor es una cifra que se perturba. */
const COUNT_KEYS = new Set(["clicks", "impressions", "sessions", "totalUsers", "count", "requests", "bytes", "solicitudes", "edgeResponseBytes", "submitted", "indexed", "errors", "warnings"]);

/** Claves cuyo valor es texto libre del cliente: siempre se sustituye. */
const FORCE_TEXT_KEYS = new Set(["title", "description", "excerpt", "error", "name", "issueMessage", "prompt", "query"]);

/** Claves cuyo valor es un dato técnico sin información del cliente: se conserva. */
const KEEP_KEYS = new Set([
  "date",
  "country",
  "device",
  "language",
  "lang",
  "htmlLang",
  "robots",
  "jsonLdTypes",
  "provider",
  "type",
  "searchType",
  "lastSubmitted",
  "lastDownloaded",
  "lastCrawlTime",
  "verdict",
  "coverageState",
  "robotsTxtState",
  "indexingState",
  "pageFetchState",
  "crawledAs",
  "severity",
  "richResultType",
  "userAgent",
  "estado",
  "día",
  "at",
  "label",
  "startDate",
  "endDate",
]);

/** Fuentes y medios habituales de GA4: no identifican al cliente. */
const KEEP_VALUES = new Set(
  [
    "google",
    "bing",
    "yahoo",
    "duckduckgo",
    "ecosia",
    "brave",
    "baidu",
    "yandex",
    "facebook",
    "instagram",
    "linkedin",
    "twitter",
    "t.co",
    "youtube",
    "(direct)",
    "(not set)",
    "(none)",
    "organic",
    "referral",
    "cpc",
    "email",
    "social",
    "direct",
    "paid",
    "display",
    "affiliate",
    "chatgpt.com",
    "chat.openai.com",
    "perplexity",
    "perplexity.ai",
    "claude.ai",
    "gemini.google.com",
    "copilot.microsoft.com",
    "bing.com",
    "google.com",
    "x-default",
  ].map((s) => s.toLowerCase()),
);

/** Valores técnicos que no pueden filtrar nada: fechas, números, constantes en mayúsculas, códigos de idioma y fuentes conocidas. */
export function isStructural(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s) ||
    /^-?\d+(?:[.,]\d+)?$/.test(s) ||
    /^[A-Z][A-Z0-9_]+$/.test(s) ||
    /^[a-z]{2}(?:[-_][A-Za-z]{2,4})?$/.test(s) ||
    KEEP_VALUES.has(s.toLowerCase())
  );
}

type Ctx = {
  name: string;
  markets: Market[];
  salt: string;
  ga4Property?: string;
  cfZone?: string;
  /** Sustituciones por clave que pisan a las reglas generales. */
  overrides: Record<string, (value: string) => string>;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function perturbValue(value: number | string, id: string, ctx: Ctx): number | string {
  if (typeof value === "number") return perturbCount(value, id, ctx.salt);
  return String(perturbCount(Number(value), id, ctx.salt));
}

function walkString(value: string, key: string, path: string, ctx: Ctx): string {
  if (value === "") return value;
  if (ctx.ga4Property && value === ctx.ga4Property) return FICTIONAL_GA4_PROPERTY;
  if (ctx.cfZone && value === ctx.cfZone) return FICTIONAL_CF_ZONE;
  const override = Object.hasOwn(ctx.overrides, key) ? ctx.overrides[key] : undefined;
  if (override) return override(value);
  if (COUNT_KEYS.has(key) && /^\d+$/.test(value)) return perturbValue(value, `${ctx.name}|${path}|${value}`, ctx) as string;
  if (FORCE_TEXT_KEYS.has(key)) return pseudoText(value, ctx.salt);
  if (KEEP_KEYS.has(key)) return value;
  const url = pseudoUrl(value, ctx.markets, ctx.salt);
  if (url !== null) return url;
  if (isStructural(value)) return value;
  return pseudoText(value, ctx.salt);
}

/** Recorre un valor cualquiera aplicando las reglas por clave. Las matrices heredan la clave de su propietario. */
function walk(value: unknown, key: string, path: string, ctx: Ctx): unknown {
  if (typeof value === "string") return walkString(value, key, path, ctx);
  if (typeof value === "number") return COUNT_KEYS.has(key) ? perturbValue(value, `${ctx.name}|${path}|${value}`, ctx) : value;
  if (Array.isArray(value)) return value.map((v, i) => walk(v, key, `${path}[${i}]`, ctx));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k, `${path}.${k}`, ctx)]));
  return value;
}

/** `consulta-N` / `pregunta-N`: N sigue el orden de un hash, no el alfabético, para no revelar el orden original. */
function numbered(values: Iterable<string>, prefix: string, salt: string): (v: string) => string {
  const unique = [...new Set(values)].filter(Boolean);
  const ordered = unique.map((v) => ({ v, h: hex(prefix, v, salt) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  const index = new Map(ordered.map((o, i) => [o.v, i + 1]));
  return (v) => (v === "" ? "" : `${prefix}-${index.get(v) ?? 0}`);
}

function makeCtx(name: string, opts: SanitizeOptions, overrides: Ctx["overrides"] = {}): Ctx {
  return { name, markets: opts.markets ?? [], salt: opts.salt ?? DEFAULT_SALT, ga4Property: opts.ga4Property, cfZone: opts.cfZone, overrides };
}

function asArray(name: string, data: unknown): unknown[] {
  if (!Array.isArray(data)) throw new Error(`${name}: se esperaba una lista y el archivo trae otra forma.`);
  return data;
}

// ---------- conjuntos de datos ----------

function gscRows(name: FixtureName, data: unknown, opts: SanitizeOptions): unknown[] {
  const rows = asArray(name, data);
  const salt = opts.salt ?? DEFAULT_SALT;
  const queries = rows.flatMap((r) => (isObj(r) && isObj(r.keys) && typeof r.keys.query === "string" ? [r.keys.query] : []));
  const queryToken = numbered(queries, "consulta", salt);
  const ctx = makeCtx(name, opts, { query: queryToken });
  return rows.map((row, i) => {
    if (!isObj(row)) return walk(row, "", `[${i}]`, ctx);
    const id = JSON.stringify(row.keys ?? null);
    const out: Record<string, unknown> = { ...row };
    out.keys = walk(row.keys, "keys", `[${i}].keys`, ctx);
    if (typeof row.clicks === "number" && typeof row.impressions === "number") {
      const impressions = perturbCount(row.impressions, `${name}|${id}|impressions`, salt);
      const clicks = Math.min(perturbCount(row.clicks, `${name}|${id}|clicks`, salt), impressions);
      out.impressions = impressions;
      out.clicks = clicks;
      if (typeof row.ctr === "number") out.ctr = impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 10_000 : 0;
    }
    if (typeof row.position === "number") out.position = Math.round(row.position * 10) / 10;
    return out;
  });
}

function ga4Rows(name: FixtureName, data: unknown, opts: SanitizeOptions): unknown[] {
  const salt = opts.salt ?? DEFAULT_SALT;
  const ctx = makeCtx(name, opts, {
    sessionSource: (v) => (isStructural(v) ? v : pseudoText(v, salt, "fuente")),
    sessionMedium: (v) => (isStructural(v) ? v : pseudoText(v, salt, "medio")),
  });
  return asArray(name, data).map((row, i) => {
    if (!isObj(row)) return walk(row, "", `[${i}]`, ctx);
    const id = JSON.stringify(row.dims ?? null);
    const out: Record<string, unknown> = { ...row };
    out.dims = walk(row.dims, "dims", `[${i}].dims`, ctx);
    if (isObj(row.metrics)) {
      const metrics = Object.fromEntries(Object.entries(row.metrics).map(([k, v]) => [k, typeof v === "number" ? perturbCount(v, `${name}|${id}|${k}`, salt) : v]));
      const s = row.metrics.sessions;
      const u = row.metrics.totalUsers;
      // Los usuarios nunca superan a las sesiones: si lo hacían menos aún tras perturbar.
      if (typeof s === "number" && typeof u === "number" && u <= s && typeof metrics.totalUsers === "number" && typeof metrics.sessions === "number") metrics.totalUsers = Math.min(metrics.totalUsers, metrics.sessions);
      out.metrics = metrics;
    }
    return out;
  });
}

function genericRows(name: FixtureName, data: unknown, opts: SanitizeOptions): unknown {
  return walk(asArray(name, data), "", "", makeCtx(name, opts));
}

function cfSummary(name: FixtureName, data: unknown, opts: SanitizeOptions): unknown {
  const salt = opts.salt ?? DEFAULT_SALT;
  const ctx = makeCtx(name, opts, {
    zone: () => FICTIONAL_CF_ZONE,
    clientRequestHTTPHost: () => FICTIONAL_HOST,
    clientRefererHost: (v) => pseudoDomain(v, salt),
  });
  if (!isObj(data)) throw new Error(`${name}: se esperaba un objeto.`);
  return walk(data, "", "", ctx);
}

function probeRuns(name: FixtureName, data: unknown, opts: SanitizeOptions): unknown[] {
  const rows = asArray(name, data);
  const salt = opts.salt ?? DEFAULT_SALT;
  const promptToken = numbered(rows.flatMap((r) => (isObj(r) && typeof r.prompt === "string" ? [r.prompt] : [])), "pregunta", salt);
  const ctx = makeCtx(name, opts, { prompt: promptToken, otherDomains: (v) => pseudoDomain(v, salt) });
  return rows.map((row, i) => {
    const out = walk(row, "", `[${i}]`, ctx);
    // `otherDomains` va ordenado en el original: se reordena tras sustituir los nombres.
    if (isObj(out) && Array.isArray(out.otherDomains)) out.otherDomains = [...(out.otherDomains as string[])].sort();
    return out;
  });
}

/** Sanea una salida del piloto. Conserva la forma del JSON; no comprueba fugas (eso lo hace `sanitizeAll`). */
export function sanitizeDataset(name: FixtureName, data: unknown, opts: SanitizeOptions = {}): unknown {
  switch (name) {
    case "gsc-search":
    case "gsc-queries":
      return gscRows(name, data, opts);
    case "ga4-report":
    case "ga4-ai":
      return ga4Rows(name, data, opts);
    case "cf-summary":
      return cfSummary(name, data, opts);
    case "probe-runs":
      return probeRuns(name, data, opts);
    case "gsc-inspection":
    case "gsc-sitemaps":
    case "crawl-pages":
      return genericRows(name, data, opts);
  }
}

// ---------- comprobación de fugas ----------

export type Leak = { kind: "host" | "ruta" | "texto" | "identificador"; sample: string };

/** Quita los tokens que pone el saneado para que no se confundan con texto original. */
const PSEUDO_TOKEN_RE = /(?:p|texto|fuente|medio|d|f)-[0-9a-f]{6}|x=[0-9a-f]{6}|(?:consulta|pregunta)-\d+/g;

function strings(value: unknown, key = "", out: Array<{ key: string; text: string }> = []): Array<{ key: string; text: string }> {
  if (typeof value === "string") out.push({ key, text: value });
  else if (Array.isArray(value)) for (const v of value) strings(v, key, out);
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) strings(v, k, out);
  return out;
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Segmentos de la ruta de una URL o ruta, ya decodificados y en minúsculas. */
function segmentsOf(urlLike: string): string[] {
  const m = URL_RE.exec(urlLike);
  const path = (m ? (m[3] ?? "") : urlLike).split(/[?#]/)[0] ?? "";
  return path.split("/").map((s) => decode(s).toLowerCase());
}

/** Fugas del original en el saneado: hosts, segmentos de ruta, textos e identificadores. Vacío si no hay ninguna. */
export function findLeaks(original: unknown, sanitized: unknown, opts: Pick<SanitizeOptions, "markets" | "known"> = {}): Leak[] {
  const after = strings(sanitized).map((s) => s.text.toLowerCase().trim());
  const afterSet = new Set(after);
  const afterStripped = after.map((s) => s.replace(PSEUDO_TOKEN_RE, "")).join("\n");
  const afterAll = after.join("\n");
  // Los valores ficticios propios no cuentan al buscar hosts: un host real corto (`e.com`) cabe dentro de `example.com`.
  const afterHosts = afterAll.replaceAll(FICTIONAL_HOST, "").replaceAll(".example.net", "");
  const afterSegments = new Set(after.filter(isUrlLike).flatMap(segmentsOf));
  const prefixSegments = new Set((opts.markets ?? []).flatMap((m) => m.prefix.split("/").map((s) => s.toLowerCase())));
  const leaks: Leak[] = [];
  const seen = new Set<string>();
  const add = (kind: Leak["kind"], sample: string) => {
    if (!seen.has(`${kind}|${sample}`)) {
      seen.add(`${kind}|${sample}`);
      leaks.push({ kind, sample });
    }
  };

  for (const { key, text } of strings(original)) {
    if (text.trim() === "") continue;
    if (isUrlLike(text) && !FORCE_TEXT_KEYS.has(key)) {
      const host = URL_RE.exec(text)?.[2]?.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
      if (host && host !== FICTIONAL_HOST && host.length >= 4 && afterHosts.includes(host)) add("host", host);
      for (const seg of segmentsOf(text)) {
        if (seg.length < 3 || prefixSegments.has(seg) || KEEP_SEGMENTS.has(seg)) continue;
        if (afterSegments.has(seg)) add("ruta", seg);
      }
      continue;
    }
    if (!FORCE_TEXT_KEYS.has(key) && (KEEP_KEYS.has(key) || isStructural(text))) continue;
    const needle = text.toLowerCase().trim();
    if (needle.length < 3) continue;
    if (afterSet.has(needle) || (needle.length >= 6 && afterStripped.includes(needle))) add("texto", needle);
  }

  // Los valores ficticios propios no cuentan: podrían contener por casualidad un identificador real.
  const asJson = JSON.stringify(sanitized).toLowerCase().replaceAll(FICTIONAL_CF_ZONE, "").replaceAll(FICTIONAL_GA4_PROPERTY, "").replaceAll(FICTIONAL_HOST, "").replaceAll(".example.net", "");
  for (const k of opts.known ?? []) {
    const needle = k.toLowerCase().trim();
    if (needle.length >= 6 && asJson.includes(needle)) add("identificador", needle);
  }
  return leaks;
}

const mask = (s: string): string => `${s.slice(0, 2)}… (${s.length} caracteres)`;

/** Falla si algún host, ruta, consulta o texto del original aparece en el saneado. El mensaje no repite los datos completos. */
export function assertNoLeaks(original: unknown, sanitized: unknown, opts: Pick<SanitizeOptions, "markets" | "known"> = {}): void {
  const leaks = findLeaks(original, sanitized, opts);
  if (leaks.length === 0) return;
  const list = leaks
    .slice(0, 5)
    .map((l) => `${l.kind}: ${mask(l.sample)}`)
    .join("; ");
  throw new Error(`El saneado dejó ${leaks.length} dato(s) del original: ${list}${leaks.length > 5 ? "…" : ""}. No se escribe nada.`);
}

/** Hosts e identificadores reales que `assertNoLeaks` debe vigilar, a partir de la configuración del piloto. */
export function knownFromConfig(c: { gscSite?: string; siteUrl?: string; ga4Property?: string; cfZone?: string }): string[] {
  const out: string[] = [];
  const host = (u: string): string | null => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  if (c.gscSite) out.push(c.gscSite.startsWith("sc-domain:") ? c.gscSite.slice("sc-domain:".length) : (host(c.gscSite) ?? c.gscSite));
  if (c.siteUrl) out.push(host(c.siteUrl) ?? c.siteUrl);
  if (c.ga4Property) out.push(c.ga4Property);
  if (c.cfZone) out.push(c.cfZone);
  return out.filter((s) => s !== FICTIONAL_HOST);
}

/**
 * Sanea todo lo que venga (los ausentes se omiten) y comprueba las fugas de cada archivo ANTES de devolver nada:
 * si alguno falla, lanza y no hay resultado que escribir.
 */
export function sanitizeAll(inputs: Partial<Record<FixtureName, unknown>>, opts: SanitizeOptions = {}): Partial<Record<FixtureName, unknown>> {
  const out: Partial<Record<FixtureName, unknown>> = {};
  for (const name of FIXTURE_NAMES) {
    const original = inputs[name];
    if (original === undefined || original === null) continue;
    const clean = sanitizeDataset(name, original, opts);
    try {
      assertNoLeaks(original, clean, { markets: opts.markets, known: opts.known });
    } catch (err) {
      throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    out[name] = clean;
  }
  return out;
}
