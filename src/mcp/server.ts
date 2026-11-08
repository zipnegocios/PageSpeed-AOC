import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiKeyAuth } from "@/server/services/api-keys";
import { describeError, TOOLS, type ToolContext, type ToolResult } from "./tools";

export type McpLog = (event: { key: string; tool: string; ok: boolean; ms: number }) => void;

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const failure = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/**
 * Servidor MCP de una petición. Solo registra las herramientas que la clave permite: lo que no
 * está en su alcance ni siquiera aparece en `tools/list`, y llamarlo por nombre da "no existe".
 */
export function createMcpServer(auth: ApiKeyAuth, options: { log?: McpLog; context?: Partial<ToolContext> } = {}): McpServer {
  const server = new McpServer({ name: "pagespeed", version: "1.0.0" });
  const allowed = new Set<string>(auth.scopes);
  const ctx: ToolContext = { keyName: auth.name, ...options.context };

  for (const tool of TOOLS) {
    if (!allowed.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.readOnly || tool.name === "run_audit" },
      },
      // El tipo del argumento lo fija el esquema de cada herramienta; aquí se trata de forma genérica.
      (async (args: never) => {
        const started = Date.now();
        try {
          const result = await (tool.run as (a: never, c: ToolContext) => Promise<unknown>)(args, ctx);
          const isError = typeof result === "object" && result !== null && "error" in result && Object.keys(result).length === 1;
          options.log?.({ key: auth.name, tool: tool.name, ok: !isError, ms: Date.now() - started });
          return isError ? failure(String((result as { error: string }).error)) : text(result);
        } catch (err) {
          options.log?.({ key: auth.name, tool: tool.name, ok: false, ms: Date.now() - started });
          if (!(err instanceof Error) || (err as { code?: unknown }).code === undefined) {
            console.error("[mcp]", tool.name, err);
          }
          return failure(describeError(err));
        }
      }) as never,
    );
  }
  return server;
}
