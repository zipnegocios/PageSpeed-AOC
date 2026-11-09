import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";
import { requestJson, type Ctx } from "./http";

export type ServiceAccountKey = { client_email: string; private_key: string };

/** Único destino válido para canjear el JWT: si la llave dijera otro, se rechaza. */
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Lee la llave JSON de la cuenta de servicio. Nunca se imprime ni se guarda en la salida. */
export function readServiceAccountKey(path: string): ServiceAccountKey {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`No se pudo leer la llave de la cuenta de servicio en ${path}.`);
  }
  const key = raw as Partial<ServiceAccountKey & { token_uri: string }>;
  if (!key.client_email || !key.private_key) throw new Error("La llave no tiene client_email o private_key: ¿es el JSON de una cuenta de servicio?");
  if (key.token_uri && key.token_uri !== TOKEN_URL) throw new Error("La llave apunta a un token_uri inesperado; se rechaza.");
  return { client_email: key.client_email, private_key: key.private_key };
}

const cache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Token de acceso de solo lectura para una cuenta de servicio: se firma un JWT RS256 con `jose` y se cambia
 * por un token en el servidor de Google. Se reutiliza hasta un minuto antes de que caduque.
 */
export async function getAccessToken(key: ServiceAccountKey, scopes: string[], deps: Ctx & { now?: () => number } = {}): Promise<string> {
  const now = deps.now ?? (() => Date.now());
  const cacheKey = `${key.client_email}|${scopes.join(" ")}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt - 60_000 > now()) return hit.token;

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
