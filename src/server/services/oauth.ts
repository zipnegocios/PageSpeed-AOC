import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { generateApiKey, hashApiKey } from "@/server/auth/api-key";
import { DomainError } from "@/server/domain/errors";
import { ACCESS_TTL_MS, CODE_TTL_MS, REFRESH_TTL_MS, isAllowedRedirectUri, isCodeChallenge, sha256, verifyPkce } from "@/server/domain/oauth";
import * as keys from "@/server/repositories/api-keys";
import * as repo from "@/server/repositories/oauth";
import { resolveKeyFields } from "./api-keys";

export type OauthDeps = { now?: () => Date };
const nowOf = (deps: OauthDeps) => (deps.now ?? (() => new Date()))();

/** Error de OAuth en el formato del RFC 6749: `error` (código estándar) y una descripción corta. */
export class OauthError extends Error {
  constructor(
    public readonly code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_redirect_uri" | "invalid_client_metadata" | "server_error",
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "OauthError";
  }
}

/** Tope de aplicaciones registradas: frena el registro masivo anónimo. */
export const MAX_CLIENTS = 200;
const DAY = 86_400_000;

const registerInput = z.object({
  client_name: z.string().trim().max(100).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(5),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/** Registro dinámico de una aplicación (RFC 7591). Solo clientes públicos y solo con direcciones de retorno permitidas. */
export async function registerClient(raw: unknown, db: Database = getDb(), deps: OauthDeps = {}) {
  const parsed = registerInput.safeParse(raw);
  if (!parsed.success) throw new OauthError("invalid_client_metadata", "Metadatos del cliente no válidos.");
  const input = parsed.data;
  if (!input.redirect_uris.every(isAllowedRedirectUri)) throw new OauthError("invalid_redirect_uri", "Alguna dirección de retorno no está permitida.");
  const now = nowOf(deps);
  if ((await repo.countClients(db)) >= MAX_CLIENTS) await repo.purgeUnusedClients(db, new Date(now.getTime() - DAY));
  if ((await repo.countClients(db)) >= MAX_CLIENTS) throw new OauthError("server_error", "Hay demasiadas aplicaciones registradas. Inténtalo más tarde.", 503);
  const name = input.client_name || "Aplicación";
  const row = await repo.insertClient(db, { name, redirectUris: [...new Set(input.redirect_uris)] });
  return {
    client_id: row.id,
    client_name: row.name,
    redirect_uris: row.redirectUris,
    token_endpoint_auth_method: "none" as const,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
  };
}

export type AuthorizeRequest = { clientId: string; clientName: string; redirectUri: string; state: string | null; codeChallenge: string };

/**
 * Valida una petición de autorización. Un cliente o una dirección de retorno no válidos NO se redirigen (se muestra una
 * página de error): redirigir a una dirección sin comprobar sería una redirección abierta.
 */
export async function validateAuthorizeRequest(query: Record<string, string | undefined>, db: Database = getDb()): Promise<AuthorizeRequest> {
  const bad = () => new DomainError("INVALID", "Esta solicitud no es válida.");
  const clientId = query.client_id ?? "";
  if (!z.uuid().safeParse(clientId).success) throw bad();
  const client = await repo.findClient(db, clientId);
  if (!client) throw bad();
  const redirectUri = query.redirect_uri ?? "";
  if (!client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) throw bad();
  if (query.response_type !== "code") throw bad();
  if (query.code_challenge_method !== "S256" || !isCodeChallenge(query.code_challenge ?? "")) throw bad();
  const state = query.state ?? null;
  if (state !== null && state.length > 1000) throw bad();
  return { clientId, clientName: client.name, redirectUri, state, codeChallenge: query.code_challenge! };
}

/** Quien autoriza elige permisos y alcance (los mismos campos que «Nueva clave»); devuelve la dirección a la que volver con el código. */
export async function authorize(admin: { id: string }, request: AuthorizeRequest, rawFields: unknown, db: Database = getDb(), deps: OauthDeps = {}): Promise<string> {
  const now = nowOf(deps);
  const date = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeZone: "UTC" }).format(now);
  const { fields } = await resolveKeyFields({ ...(rawFields as object), name: `${request.clientName.slice(0, 36)} · ${date}` }, db);
  const code = randomBytes(32).toString("base64url");
  await repo.purgeCodes(db, new Date(now.getTime() - DAY));
  await repo.insertCode(db, {
    codeHash: sha256(code),
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    keyName: fields.name,
    scopes: fields.scopes,
    allAccess: fields.allAccess,
    clientIds: fields.clientIds,
    projectIds: fields.projectIds,
    adminId: admin.id,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  return redirectBack(request.redirectUri, { code, ...(request.state !== null ? { state: request.state } : {}) });
}

/** Dirección a la que volver cuando la persona cancela. */
export function denyRedirect(request: AuthorizeRequest): string {
  return redirectBack(request.redirectUri, { error: "access_denied", ...(request.state !== null ? { state: request.state } : {}) });
}

function redirectBack(redirectUri: string, params: Record<string, string>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string };

const newRefreshToken = () => `pagespeed_refresh_${randomBytes(32).toString("base64url")}`;

/** Canjea un código por la conexión: crea la clave con lo elegido al autorizar y entrega acceso y refresco. */
export async function exchangeCode(
  input: { code: string; redirectUri: string; verifier: string; clientId: string },
  db: Database = getDb(),
  deps: OauthDeps = {},
): Promise<TokenResponse> {
  const now = nowOf(deps);
  const grant = new OauthError("invalid_grant", "El código no es válido o ya venció.");
  const client = await repo.findClient(db, input.clientId);
  if (!client) throw new OauthError("invalid_client", "Aplicación desconocida.", 401);
  const row = await repo.consumeCode(db, sha256(input.code), now);
  if (!row) throw grant;
  if (row.clientId !== client.id || row.redirectUri !== input.redirectUri || !verifyPkce(input.verifier, row.codeChallenge)) throw grant;

  const access = generateApiKey();
  const refresh = newRefreshToken();
  await keys.insertApiKey(db, {
    name: row.keyName,
    keyHash: hashApiKey(access),
    scopes: row.scopes,
    allAccess: row.allAccess,
    clientIds: row.clientIds,
    projectIds: row.projectIds,
    oauthClientId: client.id,
    expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
    refreshHash: sha256(refresh),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
  });
  await repo.touchClient(db, client.id, now);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh };
}

/** Renueva acceso y refresco. El refresco es de un solo uso: si uno ya gastado vuelve a presentarse, se revoca la conexión. */
export async function refreshTokens(input: { refreshToken: string; clientId: string }, db: Database = getDb(), deps: OauthDeps = {}): Promise<TokenResponse> {
  const now = nowOf(deps);
  const invalid = new OauthError("invalid_grant", "El token de refresco no es válido o ya venció.");
  const hash = sha256(input.refreshToken);
  const row = await keys.findActiveByRefreshHash(db, hash);
  if (!row) {
    const stolen = await keys.findByPrevRefreshHash(db, hash);
    if (stolen) await keys.revokeKey(db, stolen.id, now);
    throw invalid;
  }
  if (row.oauthClientId !== input.clientId) throw invalid;
  if (!row.refreshExpiresAt || row.refreshExpiresAt.getTime() <= now.getTime()) throw invalid;

  const access = generateApiKey();
  const refresh = newRefreshToken();
  const updated = await keys.rotateOauthTokens(db, row.id, hash, {
    keyHash: hashApiKey(access),
    refreshHash: sha256(refresh),
    expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    at: now,
  });
  if (!updated) throw invalid;
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh };
}

/** Revoca la conexión a la que pertenece un token de acceso o de refresco (RFC 7009: nunca dice si existía). */
export async function revokeToken(token: string, db: Database = getDb(), deps: OauthDeps = {}): Promise<void> {
  const now = nowOf(deps);
  const byRefresh = await keys.findActiveByRefreshHash(db, sha256(token));
  const row = byRefresh ?? (await keys.findActiveByHash(db, hashApiKey(token)));
  if (row?.oauthClientId) await keys.revokeKey(db, row.id, now);
}

