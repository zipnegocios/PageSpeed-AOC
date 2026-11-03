import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { getLocale } from "@/lib/locale";
import { Alert } from "@/lib/ui/components/alert";
import { ReportFrame } from "@/lib/ui/components/report-frame";
import { getPortalAudit } from "@/server/services/portal";
import { BlockedNotice } from "../../../../_components/blocked-notice";
import { PortalShell } from "../../../../_components/portal-shell";
import { SuspendedNotice } from "../../../../_components/suspended-notice";
import { portalAccess } from "../../../../_lib/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Detalle técnico · AOC PageSpeed", robots: { index: false, follow: false } };

export default async function PortalAuditDetail({ params }: { params: Promise<{ token: string; projectId: string; auditId: string }> }) {
  const { token, projectId, auditId } = await params;
  const access = await portalAccess(token);
  if (access.state === "blocked") return <BlockedNotice />;
  if (access.state === "suspended") return <SuspendedNotice clientName={access.clientName} />;
  const found = await getPortalAudit(access.client.id, projectId, auditId);
  if (!found) notFound();
  const { audit, redact } = found;
  const locale = await getLocale();
  const base = `/c/${token}/${projectId}`;

  return (
    <PortalShell
      clientName={access.client.name}
      title="Detalle técnico"
      subtitle={
        <>
          <span className="font-mono text-[15px] break-all">{audit.routePath}</span> · {PROFILE_LABEL[audit.profile]} · {formatDate(audit.finishedAt)}
          {" · "}
          <Link href={base} className="font-semibold text-link hover:underline">
            Volver al resumen
          </Link>
        </>
      }
    >
      {redact ? <Alert tone="info">Las capturas de páginas con sesión no se muestran.</Alert> : null}
      <ReportFrame src={`${base}/detalle/${audit.id}/informe`} locale={locale} returnTo={`${base}/detalle/${audit.id}`} title="Informe técnico de Lighthouse" />
    </PortalShell>
  );
}
