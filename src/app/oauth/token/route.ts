import { clientIp } from "@/lib/auth/client-ip";
import { oauthLimiters } from "@/lib/auth/oauth-limiters";
import { oauthErrorResponse, oauthJson, oauthPreflight, readParams } from "@/lib/oauth-http";
import { OauthError, exchangeCode, refreshTokens } from "@/server/services/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Entrega los tokens: canjea un código de autorización o renueva con un token de refresco. */
export async function POST(req: Request): Promise<Response> {
  try {
    const ip = await clientIp();
    const limiter = oauthLimiters.token;
    if (limiter.isBlocked(ip)) throw new OauthError("invalid_request", "Demasiadas peticiones. Espera unos minutos.", 429);
    limiter.recordFailure(ip);

    const p = await readParams(req);
    if (p.grant_type === "authorization_code") {
      if (!p.code || !p.redirect_uri || !p.code_verifier || !p.client_id) throw new OauthError("invalid_request", "Faltan parámetros.");
      return oauthJson(200, await exchangeCode({ code: p.code, redirectUri: p.redirect_uri, verifier: p.code_verifier, clientId: p.client_id }));
    }
    if (p.grant_type === "refresh_token") {
      if (!p.refresh_token || !p.client_id) throw new OauthError("invalid_request", "Faltan parámetros.");
      return oauthJson(200, await refreshTokens({ refreshToken: p.refresh_token, clientId: p.client_id }));
    }
    throw new OauthError("unsupported_grant_type", "Solo se admite authorization_code y refresh_token.");
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

export const OPTIONS = oauthPreflight;
