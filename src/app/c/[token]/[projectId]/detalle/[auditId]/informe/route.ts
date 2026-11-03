import { REPORT_HEADERS, parseLocale } from "@/server/report/lighthouse-report";
import { getOfficialReportHtml } from "@/server/services/audit-lhr";
import { getPortalAudit } from "@/server/services/portal";
import { checkPortal } from "../../../../../_lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const plain = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Informe oficial de Lighthouse para el cliente, con la misma autorización que el portal. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; projectId: string; auditId: string }> }) {
  const { token, projectId, auditId } = await params;
  const access = await checkPortal(token);
  if (access.state === "blocked") return plain(429, "Demasiados intentos. Espera unos minutos.");
  if (access.state === "invalid") return plain(404, "Enlace no válido");
  if (access.state === "suspended") return plain(403, "Tu servicio está suspendido.");
  if (access.state === "legacy") return plain(404, "Enlace no válido");
  if (access.state === "pin") return plain(401, "Escribe tu PIN en el portal para ver este contenido.");
  const found = await getPortalAudit(access.client.id, projectId, auditId);
  if (!found) return plain(404, "Enlace no válido");
  try {
    const html = await getOfficialReportHtml(found.audit, parseLocale(new URL(req.url).searchParams.get("lang")), { redact: found.redact });
    if (!html) return plain(404, "Esta auditoría no tiene un informe guardado.");
    return new Response(html, { headers: REPORT_HEADERS });
  } catch (err) {
    console.error("[informe-lighthouse-portal]", err);
    return plain(500, "No se pudo generar el informe.");
  }
}
