import { apiAuditAccess } from "@/lib/auth/access";
import { isDomainError } from "@/server/domain/errors";
import { getAuditReportFile } from "@/server/services/audits";

export const dynamic = "force-dynamic";

/** Descarga el JSON completo de una auditoría. Solo para el administrador. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 401 sin sesión; 404 si la persona no ve el proyecto de esta auditoría (igual que si no existiera).
  const denied = await apiAuditAccess(id);
  if (denied instanceof Response) return denied;
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
