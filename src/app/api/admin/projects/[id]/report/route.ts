import { getSession } from "@/lib/auth/session";
import { isDomainError } from "@/server/domain/errors";
import { parsePeriod } from "@/server/domain/history";
import { parseReportKind } from "@/server/domain/report-outline";
import { getProjectReportPdf } from "@/server/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Informe del proyecto en PDF (`?tipo=resumen|ingenieria`, `?dias=`). Solo para el administrador. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) {
    return Response.json({ error: "No autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const days = parsePeriod(q.get("dias"));
  const kind = parseReportKind(q.get("tipo"));
  try {
    const { filename, pdf } = await getProjectReportPdf(id, days, kind);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (isDomainError(err)) {
      return Response.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 400, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[informe-pdf]", err);
    return Response.json({ error: "No se pudo generar el informe" }, { status: 500 });
  }
}
