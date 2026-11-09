import { appUrl } from "@/lib/not-found";
import { oauthJson, oauthPreflight } from "@/lib/oauth-http";

export const dynamic = "force-dynamic";

/** Metadatos del recurso protegido (RFC 9728): dónde está el MCP y quién da las credenciales. */
export async function GET(): Promise<Response> {
  const base = appUrl();
  return oauthJson(200, {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    resource_name: "PageSpeed",
  });
}

export const OPTIONS = oauthPreflight;
