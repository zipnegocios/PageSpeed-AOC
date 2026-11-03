import { getSession } from "@/lib/auth/session";
import { isDomainError } from "@/server/domain/errors";
import { fullPageImage } from "@/server/domain/lhr-view";
import { loadAuditLhr } from "@/server/services/audit-lhr";
import { getAudit } from "@/server/services/audits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Captura de página completa de una auditoría (para las evidencias del visor). Solo administrador. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return new Response("No autorizado", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  try {
    const lhr = await loadAuditLhr(await getAudit(id));
    const image = lhr ? fullPageImage(lhr) : null;
    if (!image) return new Response("Sin captura", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch (err) {
    if (isDomainError(err)) return new Response(err.message, { status: err.code === "NOT_FOUND" ? 404 : 400 });
    console.error("[captura]", err);
    return new Response("No se pudo leer la captura", { status: 500 });
  }
}
