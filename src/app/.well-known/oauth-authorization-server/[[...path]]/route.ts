import { appUrl } from "@/lib/not-found";
import { oauthJson, oauthPreflight } from "@/lib/oauth-http";

export const dynamic = "force-dynamic";

/** Metadatos del servidor de autorización (RFC 8414). */
export async function GET(): Promise<Response> {
  const base = appUrl();
  return oauthJson(200, {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
  });
}

export const OPTIONS = oauthPreflight;
