import { fullPageImage } from "@/server/domain/lhr-view";
import { loadAuditLhr } from "@/server/services/audit-lhr";
import { getPortalAudit } from "@/server/services/portal";
import { checkPortal } from "../../../../../_lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const plain = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Captura de página completa para el cliente. Nunca de rutas con sesión: ahí puede haber datos del usuario de prueba. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; projectId: string; auditId: string }> }) {
  const { token, projectId, auditId } = await params;
  const access = await checkPortal(token);
  if (access.state === "blocked") return plain(429, "Demasiados intentos. Espera unos minutos.");
  if (access.state === "invalid") return plain(404, "Enlace no válido");
  if (access.state === "suspended") return plain(403, "Tu servicio está suspendido.");
  const found = await getPortalAudit(access.client.id, projectId, auditId);
  if (!found || found.redact) return plain(404, "Sin captura");
  const lhr = await loadAuditLhr(found.audit);
  const image = lhr ? fullPageImage(lhr) : null;
  if (!image) return plain(404, "Sin captura");
  return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
