import { parsePeriod } from "@/server/domain/history";
import { getProjectReportPdf } from "@/server/report";
import { getPortalProject } from "@/server/services/portal";
import { checkPortal } from "../../../_lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const plain = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Informe en PDF para el cliente. Misma autorización que el portal: token vigente, cliente activo y proyecto suyo. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; projectId: string }> }) {
  const { token, projectId } = await params;
  const access = await checkPortal(token);
  if (access.state === "blocked") return plain(429, "Demasiados intentos. Espera unos minutos.");
  if (access.state === "invalid") return plain(404, "Enlace no válido");
  if (access.state === "suspended") return plain(403, "Tu servicio está suspendido.");
  const project = await getPortalProject(access.client.id, projectId);
  if (!project) return plain(404, "Enlace no válido");

  const days = parsePeriod(new URL(req.url).searchParams.get("dias"));
  try {
    const { filename, pdf } = await getProjectReportPdf(project.id, days);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[informe-pdf]", err);
    return plain(500, "No se pudo generar el informe");
  }
}
