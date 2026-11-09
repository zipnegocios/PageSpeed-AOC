import { oauthErrorResponse, oauthJson, oauthPreflight, readParams } from "@/lib/oauth-http";
import { revokeToken } from "@/server/services/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Revoca una conexión (RFC 7009). Responde 200 exista o no el token. */
export async function POST(req: Request): Promise<Response> {
  try {
    const p = await readParams(req);
    if (p.token) await revokeToken(p.token);
    return oauthJson(200, {});
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

export const OPTIONS = oauthPreflight;
