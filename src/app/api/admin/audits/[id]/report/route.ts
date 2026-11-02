import { getSession } from "@/lib/auth/session";
import { isDomainError } from "@/server/domain/errors";
import { getAuditReportFile } from "@/server/services/audits";

export const dynamic = "force-dynamic";

/** Descarga el JSON completo de una auditoría. Solo para el administrador. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) {
    return Response.json({ error: "No autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await params;
  try {
    const { filename, json } = await getAuditReportFile(id);
    // El nombre sale de la clave de R2 (solo letras, números, guiones y puntos), pero se sanea igual.
    const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(new Uint8Array(json), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safe}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (isDomainError(err)) {
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "UPSTREAM" ? 502 : 400;
      return Response.json({ error: err.message }, { status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[informe]", err);
    return Response.json({ error: "Error inesperado" }, { status: 500 });
  }
}
