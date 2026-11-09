import { DomainError } from "./errors";

/**
 * Conexiones del módulo SEO y visibilidad en IA. Lógica pura: valida los identificadores que pega la persona
 * administradora y traduce los fallos de Google y Cloudflare a mensajes que dicen qué hacer.
 */

export const SEO_KINDS = ["gsc", "ga4", "cloudflare"] as const;
export type SeoKind = (typeof SEO_KINDS)[number];

export const KIND_LABEL: Record<SeoKind, string> = { gsc: "Search Console", ga4: "Google Analytics 4", cloudflare: "Cloudflare" };

export function parseKind(raw: string): SeoKind {
  if ((SEO_KINDS as readonly string[]).includes(raw)) return raw as SeoKind;
  throw new DomainError("INVALID", "Tipo de conexión desconocido.");
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const invalid = (message: string): never => {
  throw new DomainError("INVALID", message);
};

/**
 * Propiedad de Search Console. Acepta `sc-domain:ejemplo.com`, una URL (propiedad de prefijo, que termina en `/`)
 * o un dominio suelto, que se toma como propiedad de dominio.
 */
export function normalizeGscProperty(raw: string): string {
  const text = raw.trim();
  if (!text) return invalid("Indica la propiedad de Search Console, por ejemplo sc-domain:ejemplo.com.");
  if (/^sc-domain:/i.test(text)) {
    const host = text.slice("sc-domain:".length).trim().toLowerCase();
    return DOMAIN_RE.test(host) ? `sc-domain:${host}` : invalid("El dominio de la propiedad no es válido. Ejemplo: sc-domain:ejemplo.com.");
  }
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return invalid("La dirección de la propiedad no es válida. Ejemplo: https://ejemplo.com/.");
    }
    const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return `${url.protocol}//${url.host}${path}`;
  }
  const host = text.toLowerCase();
  if (DOMAIN_RE.test(host)) return `sc-domain:${host}`;
  return invalid("No reconozco esa propiedad. Usa sc-domain:ejemplo.com (dominio) o https://ejemplo.com/ (prefijo de URL).");
}

/** ID numérico de la propiedad de GA4 (no el ID de medición `G-XXXX`). Acepta `properties/123`. */
export function normalizeGa4Property(raw: string): string {
  const text = raw.trim().replace(/^properties\//i, "");
  if (/^(G|UA)-/i.test(text)) {
    return invalid("Ese es un ID de medición. Necesito el ID numérico de la propiedad: en GA4, Administrar → Detalles de la propiedad.");
  }
  return /^\d{5,15}$/.test(text) ? text : invalid("El ID de la propiedad de GA4 es un número. Lo encuentras en Administrar → Detalles de la propiedad.");
}

/** ID de zona de Cloudflare: 32 caracteres hexadecimales. */
export function normalizeCloudflareZone(raw: string): string {
  const text = raw.trim().toLowerCase();
  return /^[a-f0-9]{32}$/.test(text) ? text : invalid("El ID de zona de Cloudflare tiene 32 caracteres (letras a-f y números). Está en la página principal de la zona, a la derecha.");
}

export function normalizeCloudflareToken(raw: string): string {
  const text = raw.trim();
  return text.length >= 20 && !/\s/.test(text) ? text : invalid("El token de Cloudflare no parece válido: debe ser una sola cadena larga, sin espacios.");
}

export function normalizeExternalId(kind: SeoKind, raw: string): string {
  if (kind === "gsc") return normalizeGscProperty(raw);
  if (kind === "ga4") return normalizeGa4Property(raw);
  return normalizeCloudflareZone(raw);
}

/** Permiso con el que la cuenta de servicio ve una propiedad de Search Console, en palabras normales. */
export function gscPermissionText(level: string): string {
  const map: Record<string, string> = {
    siteOwner: "propietario",
    siteFullUser: "usuario con permiso completo",
    siteRestrictedUser: "usuario restringido",
    siteUnverifiedUser: "usuario sin verificar",
  };
  return map[level] ?? level;
}

/**
 * Qué hacer ante un fallo de la API. `code` es el de SpikeHttpError (AUTH, FORBIDDEN, NOT_FOUND, QUOTA,
 * BAD_REQUEST, UNAVAILABLE). Los mensajes nunca incluyen credenciales.
 */
export function explainFailure(kind: SeoKind, code: string, ctx: { email?: string | null } = {}): string {
  const who = ctx.email ? ` ${ctx.email}` : " la cuenta de servicio";
  if (code === "QUOTA") return `${KIND_LABEL[kind]} pide esperar (límite de consultas). Inténtalo de nuevo en unos minutos.`;
  if (code === "UNAVAILABLE") return `No se pudo contactar con ${KIND_LABEL[kind]}. Inténtalo de nuevo en unos minutos.`;
  if (kind === "gsc") {
    return `Google no dejó entrar. Revisa que la Search Console API esté habilitada en el proyecto de Google Cloud y que${who} tenga acceso a la propiedad.`;
  }
  if (kind === "ga4") {
    if (code === "NOT_FOUND" || code === "BAD_REQUEST") return "No se encontró esa propiedad de GA4. Revisa el ID numérico (Administrar → Detalles de la propiedad).";
    return `La cuenta de servicio no tiene acceso a esta propiedad. En GA4, Administrar → Administración de accesos a la propiedad, agrega${who} con el rol Lector. Revisa también que la Google Analytics Data API esté habilitada.`;
  }
  return "Cloudflare rechazó la consulta. El token debe estar activo y tener permiso de lectura de analíticas sobre esa zona.";
}
