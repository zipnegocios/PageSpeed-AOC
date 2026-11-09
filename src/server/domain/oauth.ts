import { createHash, timingSafeEqual } from "node:crypto";

/** Vigencias: el código se canjea enseguida; el acceso dura una hora y el refresco, 90 días. */
export const CODE_TTL_MS = 10 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000;

/** Direcciones de retorno de claude.ai (web y escritorio). */
const FIXED_REDIRECTS = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);

/**
 * ¿Es una dirección de retorno permitida? Las de claude.ai/claude.com, exactas, y las de bucle local
 * (`http://localhost`, `127.0.0.1`, `[::1]` con cualquier puerto y ruta: clientes de escritorio y de línea de comandos).
 * Nunca con credenciales en la URL ni con fragmento.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  if (FIXED_REDIRECTS.has(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.username || u.password || u.hash) return false;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

export const isCodeChallenge = (value: string) => CHALLENGE_RE.test(value);

/** PKCE con S256: `base64url(sha256(verifier))` debe ser el desafío que se dio al pedir el código. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier) || !CHALLENGE_RE.test(challenge)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** Lo único que se guarda de un código o de un token de refresco: su sha256. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
