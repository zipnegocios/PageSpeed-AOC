import { getSession } from "@/lib/auth/session";
import { checkDependencies } from "@/server/services/health";

export const dynamic = "force-dynamic";

/** Estado de Postgres, Redis, R2 y SMTP. Solo para el administrador. */
export async function GET() {
  if (!(await getSession())) {
    return Response.json({ error: "No autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const report = await checkDependencies();
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
