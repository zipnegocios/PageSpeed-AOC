import { importPKCS8, SignJWT } from "jose";
import { requestJson, type Ctx } from "./http";

export type ServiceAccountKey = { client_email: string; private_key: string };

/** Único destino válido para canjear el JWT: si la llave dijera otro, se rechaza. */
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Interpreta el texto de la llave JSON de una cuenta de servicio. Valida que tenga correo y llave privada y que
 * apunte al servidor de tokens de Google. Los mensajes nunca incluyen el contenido de la llave.
 */
export function parseServiceAccountKey(text: string): ServiceAccountKey {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("El contenido no es un JSON válido: pega el archivo de la llave completo.");
  }
  const key = (raw ?? {}) as Partial<ServiceAccountKey & { token_uri: string }>;
  if (!key.client_email || !key.private_key) throw new Error("La llave no tiene client_email o private_key: ¿es el JSON de una cuenta de servicio?");
  if (key.token_uri && key.token_uri !== TOKEN_URL) throw new Error("La llave apunta a un token_uri inesperado; se rechaza.");
  return { client_email: key.client_email, private_key: key.private_key };
}

/**
 * Cuenta de servicio desde una variable de entorno. Acepta el JSON de la llave (en una línea o en varias) o ese mismo
 * JSON codificado en base64, que evita los problemas de comillas de algunos editores de variables. Tolera que el valor
 * venga envuelto en comillas.
 */
/**
 * Qué parece el valor que no sirvió, para que el mensaje oriente sin mostrar su contenido (puede ser un secreto):
 * solo se dice el tipo de cosa que parece y cuántos caracteres tiene.
 */
function describeEnvValue(text: string): string {
  if (/^AIza[\w-]{30,}$/.test(text)) return "Parece una clave de API (empieza por «AIza»). Esa no sirve: hace falta el JSON de una cuenta de servicio.";
  if (/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return "Parece la llave privada sola. Hace falta el archivo JSON completo, que la incluye junto al correo de la cuenta.";
  if (/^["']?(\/|~|\.{1,2}\/|[A-Za-z]:\\)/.test(text) || /\.json["']?$/i.test(text)) return "Parece una ruta o el nombre de un archivo. Hay que poner el contenido del archivo, no dónde está.";
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s/g, "").length >= 40) return `Parece base64 (${text.replace(/\s/g, "").length} caracteres), pero al decodificarlo no es un JSON. Revisa que se codificó el archivo correcto y completo.`;
  if (/\s/.test(text)) return `Tiene ${text.length} caracteres con espacios o saltos de línea y no empieza por «{»: si es un mensaje de error de un comando, el valor no se generó bien.`;
  return `Tiene ${text.length} caracteres y no empieza por «{». Debe ser el JSON (empieza por «{») o ese JSON en base64.`;
}

export function parseServiceAccountEnv(value: string): ServiceAccountKey {
  let text = value.trim();
  if (text.length > 1 && (text[0] === "'" || text[0] === '"') && text.endsWith(text[0] as string)) text = text.slice(1, -1).trim();
  if (text.startsWith("{")) return parseServiceAccountKey(text);
  const decoded = Buffer.from(text, "base64").toString("utf8").trim();
  if (!decoded.startsWith("{")) throw new Error(`El valor no es el JSON de la cuenta de servicio ni ese JSON codificado en base64. ${describeEnvValue(text)}`);
  return parseServiceAccountKey(decoded);
}

const cache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Token de acceso de solo lectura para una cuenta de servicio: se firma un JWT RS256 con `jose` y se cambia
 * por un token en el servidor de Google. Se reutiliza hasta un minuto antes de que caduque.
 */
export async function getAccessToken(key: ServiceAccountKey, scopes: string[], deps: Ctx & { now?: () => number; /** Ignora el token en caché (por ejemplo, al validar una llave recién pegada). */ fresh?: boolean; /** Reintentos ante 429 y 5xx (por defecto, los de requestJson). */ retries?: number } = {}): Promise<string> {
  const now = deps.now ?? (() => Date.now());
  const cacheKey = `${key.client_email}|${scopes.join(" ")}`;
  const hit = cache.get(cacheKey);
  if (!deps.fresh && hit && hit.expiresAt - 60_000 > now()) return hit.token;

  const iat = Math.floor(now() / 1000);
  const assertion = await new SignJWT({ scope: scopes.join(" ") })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(key.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(await importPKCS8(key.private_key, "RS256"));

  const res = await requestJson<{ access_token?: string; expires_in?: number }>({
    ...deps,
    label: "oauth-token",
    url: TOKEN_URL,
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.access_token) throw new Error("Google no devolvió un token de acceso.");
  cache.set(cacheKey, { token: res.access_token, expiresAt: now() + (res.expires_in ?? 3600) * 1000 });
  return res.access_token;
}

/** Solo para pruebas. */
export function clearTokenCache(): void {
  cache.clear();
}
