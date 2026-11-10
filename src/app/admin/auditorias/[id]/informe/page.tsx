import { requireAuditAccess } from "@/lib/auth/access";
import type { Metadata } from "next";
import { PROFILE_LABEL } from "@/lib/audit-format";
import { clientPath, projectPath } from "@/lib/urls";
import { getLocale } from "@/lib/locale";
import { orNotFound } from "@/lib/not-found";
import { Alert } from "@/lib/ui/components/alert";
import { ReportFrame } from "@/lib/ui/components/report-frame";
import { getAudit, getSiblingAudits } from "@/server/services/audits";
import { ProfileSwitch } from "@/lib/ui/components/profile-switch";
import { AdminShell } from "../../../_components/admin-shell";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Informe de Lighthouse"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AuditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await orNotFound(requireAuditAccess(id));
  const audit = await orNotFound(getAudit(id));
  const siblings = await getSiblingAudits(id);
  const locale = await getLocale();
  const ready = audit.status === "succeeded" && audit.r2Key;

  return (
    <AdminShell
     
      title="Informe completo de Lighthouse"
      subtitle={`${audit.routePath} · ${PROFILE_LABEL[audit.profile]} · ${audit.projectName}`}
      crumbs={[
        { label: "Panel", href: "/admin" },
        { label: audit.clientName, href: clientPath(audit.clientSlug) },
        { label: audit.projectName, href: projectPath(audit.clientSlug, audit.projectSlug) },
        { label: "Auditoría", href: `/admin/auditorias/${audit.id}` },
      ]}
    >
      <ProfileSwitch current={audit.profile} currentScore={audit.scorePerformance} siblings={siblings} currentHref={`/admin/auditorias/${audit.id}/informe`} hrefFor={(sid) => `/admin/auditorias/${sid}/informe`} />
      {ready ? (
        <ReportFrame src={`/api/admin/audits/${audit.id}/lighthouse`} locale={locale} returnTo={`/admin/auditorias/${audit.id}/informe`} title="Informe oficial de Lighthouse" />
      ) : (
        <Alert tone="info">Esta auditoría no tiene un informe guardado.</Alert>
      )}
    </AdminShell>
  );
}
