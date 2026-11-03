import type { Metadata } from "next";
import { PROFILE_LABEL } from "@/lib/audit-format";
import { verifySession } from "@/lib/auth/session";
import { getLocale } from "@/lib/locale";
import { orNotFound } from "@/lib/not-found";
import { Alert } from "@/lib/ui/components/alert";
import { ReportFrame } from "@/lib/ui/components/report-frame";
import { getAudit } from "@/server/services/audits";
import { AdminShell } from "../../../_components/admin-shell";

export const metadata: Metadata = { title: "Informe de Lighthouse · AOC PageSpeed", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AuditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  const { id } = await params;
  const audit = await orNotFound(getAudit(id));
  const locale = await getLocale();
  const ready = audit.status === "succeeded" && audit.r2Key;

  return (
    <AdminShell
      email={session.email}
      title="Informe completo de Lighthouse"
      subtitle={`${audit.routePath} · ${PROFILE_LABEL[audit.profile]} · ${audit.projectName}`}
      crumbs={[
        { label: "Panel", href: "/admin" },
        { label: audit.clientName, href: `/admin/clientes/${audit.clientId}` },
        { label: audit.projectName, href: `/admin/proyectos/${audit.projectId}` },
        { label: "Auditoría", href: `/admin/auditorias/${audit.id}` },
      ]}
    >
      {ready ? (
        <ReportFrame src={`/api/admin/audits/${audit.id}/lighthouse`} locale={locale} returnTo={`/admin/auditorias/${audit.id}/informe`} title="Informe oficial de Lighthouse" />
      ) : (
        <Alert tone="info">Esta auditoría no tiene un informe guardado.</Alert>
      )}
    </AdminShell>
  );
}
