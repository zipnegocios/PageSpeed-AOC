import { isLive } from "@/server/services/health";

export const dynamic = "force-dynamic";

/** Comprobación pública y mínima (sin detalles): 200 si el proceso está vivo y ve la base. */
export async function GET() {
  const ok = await isLive();
  return Response.json({ status: ok ? "ok" : "unavailable" }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
