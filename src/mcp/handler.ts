import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { parseBearer } from "@/server/auth/api-key";
import { AttemptLimiter } from "@/server/auth/rate-limit";
import { authenticateApiKey, type ApiKeyAuth } from "@/server/services/api-keys";
import { createMcpServer, type McpLog } from "./server";
import type { ToolContext } from "./tools";

export type McpDeps = {
  authenticate?: (key: string) => Promise<ApiKeyAuth | null>;
  /** Origen público del web; una petición con otro `Origin` (un navegador ajeno) se rechaza. */
  appOrigin: string;
  ip: string;
  /** Límites en memoria compartidos por el proceso. */
  limits: { perKey: AttemptLimiter; badAuthPerIp: AttemptLimiter };
  log?: McpLog;
  context?: Partial<ToolContext>;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

const rpcError = (status: number, code: number, message: string, headers?: Record<string, string>) =>
  json(status, { jsonrpc: "2.0", error: { code, message }, id: null }, headers);

export const createLimits = () => ({
  // 60 llamadas por minuto y clave; 20 autenticaciones fallidas cada 10 minutos por IP.
  perKey: new AttemptLimiter({ max: 60, windowMs: 60_000 }),
  badAuthPerIp: new AttemptLimiter({ max: 20, windowMs: 10 * 60_000 }),
});

/**
 * Atiende una petición MCP (Streamable HTTP sin sesión: cada petición es independiente, no hay
 * estado en el servidor). Orden: origen, límite por IP, clave, límite por clave, protocolo.
 */
export async function handleMcpRequest(req: Request, deps: McpDeps): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && origin !== deps.appOrigin) return rpcError(403, -32000, "Origen no permitido.");

  if (deps.limits.badAuthPerIp.isBlocked(deps.ip)) {
    return rpcError(429, -32000, "Demasiados intentos con clave no válida. Espera unos minutos.", {
      "Retry-After": String(deps.limits.badAuthPerIp.retryAfterSeconds(deps.ip)),
    });
  }

  const token = parseBearer(req.headers.get("authorization"));
  const auth = token ? await (deps.authenticate ?? authenticateApiKey)(token) : null;
  if (!auth) {
    deps.limits.badAuthPerIp.recordFailure(deps.ip);
    return rpcError(401, -32001, "Falta una clave de API válida (Authorization: Bearer ...).", {
      // `resource_metadata` (RFC 9728) es lo que permite a claude.ai descubrir el inicio de sesión OAuth.
      "WWW-Authenticate": `Bearer realm="pagespeed", resource_metadata="${deps.appOrigin}/.well-known/oauth-protected-resource"`,
    });
  }

  if (deps.limits.perKey.isBlocked(auth.id)) {
    return rpcError(429, -32000, "Demasiadas llamadas con esta clave. Espera un momento.", {
      "Retry-After": String(deps.limits.perKey.retryAfterSeconds(auth.id)),
    });
  }
  deps.limits.perKey.recordFailure(auth.id); // cuenta cada llamada, no solo los fallos

  if (req.method !== "POST") {
    // Sin sesiones no hay flujo de eventos del servidor que abrir ni cerrar.
    return rpcError(405, -32000, "Solo se admite POST (servidor sin sesión).", { Allow: "POST" });
  }

  const server = createMcpServer(auth, { log: deps.log, context: deps.context, appOrigin: deps.appOrigin });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    return response;
  } finally {
    // La respuesta ya está completa (modo JSON): se libera todo lo de esta petición.
    queueMicrotask(() => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
  }
}
