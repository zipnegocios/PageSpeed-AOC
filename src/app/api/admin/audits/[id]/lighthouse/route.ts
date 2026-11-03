import { getSession } from "@/lib/auth/session";
import { isDomainError } from "@/server/domain/errors";
import { REPORT_HEADERS, parseLocale } from "@/server/report/lighthouse-report";
import { getOfficialReportHtml } from "@/server/services/audit-lhr";
import { getAudit } from "@/server/services/audits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Informe oficial de Lighthouse de una auditoría, para el marco aislado del panel. Solo administrador. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) {
    return Response.json({ error: "No autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await params;
  try {
    const audit = await getAudit(id);
    const html = await getOfficialReportHtml(audit, parseLocale(new URL(req.url).searchParams.get("lang")));
    if (!html) return new Response("Esta auditoría no tiene un informe guardado.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    return new Response(html, { headers: REPORT_HEADERS });
  } catch (err) {
    if (isDomainError(err)) return new Response(err.message, { status: err.code === "NOT_FOUND" ? 404 : 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    console.error("[informe-lighthouse]", err);
    return new Response("No se pudo generar el informe.", { status: 500 });
  }
}
