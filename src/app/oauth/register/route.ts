import { clientIp } from "@/lib/auth/client-ip";
import { oauthLimiters } from "@/lib/auth/oauth-limiters";
import { oauthErrorResponse, oauthJson, oauthPreflight } from "@/lib/oauth-http";
import { OauthError, registerClient } from "@/server/services/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Registro dinámico de aplicaciones (RFC 7591), para que claude.ai se dé de alta sin pasos manuales. */
export async function POST(req: Request): Promise<Response> {
  try {
    const ip = await clientIp();
    const limiter = oauthLimiters.register;
    if (limiter.isBlocked(ip)) throw new OauthError("server_error", "Demasiados registros desde tu conexión. Espera unos minutos.", 429);
    limiter.recordFailure(ip);
    const body = await req.json().catch(() => null);
    return oauthJson(201, await registerClient(body));
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

export const OPTIONS = oauthPreflight;
