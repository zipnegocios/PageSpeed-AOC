import { handleMcpRequest, createLimits } from "@/mcp/handler";
import { clientIp } from "@/lib/auth/client-ip";
import { appUrl } from "@/lib/not-found";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Un único juego de límites por proceso; sobrevive a las recargas de módulos en desarrollo.
const g = globalThis as unknown as { __aocMcpLimits?: ReturnType<typeof createLimits> };
const limits = (g.__aocMcpLimits ??= createLimits());

async function handle(req: Request): Promise<Response> {
  return handleMcpRequest(req, {
    appOrigin: new URL(appUrl()).origin,
    ip: await clientIp(),
    limits,
    log: (e) => console.info("[mcp]", JSON.stringify(e)),
  });
}

export { handle as POST, handle as GET, handle as DELETE };
