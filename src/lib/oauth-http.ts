import { OauthError } from "@/server/services/oauth";

/** Cabeceras de las respuestas OAuth: sin caché y con CORS abierto (los clientes de navegador, como el Inspector de MCP, lo necesitan). */
export const OAUTH_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};

export function oauthJson(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...OAUTH_HEADERS, ...extra } });
}

export function oauthPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...OAUTH_HEADERS, "Access-Control-Max-Age": "86400" } });
}

/** Un error de OAuth en el formato del RFC 6749. Los errores inesperados no se detallan. */
export function oauthErrorResponse(err: unknown): Response {
  if (err instanceof OauthError) {
    return oauthJson(err.status, { error: err.code, error_description: err.message }, err.status === 401 ? { "WWW-Authenticate": "Basic" } : {});
  }
  console.error("[oauth]", err);
  return oauthJson(500, { error: "server_error", error_description: "Error inesperado en el servidor." });
}

/** Lee el cuerpo de una petición del endpoint de token: formulario (lo normal) o JSON. */
export async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    return out;
  }
  const form = await req.formData().catch(() => null);
  if (form) for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
