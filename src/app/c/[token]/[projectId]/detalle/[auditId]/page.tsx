import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditViewer, type ViewerSearch } from "@/app/_components/audit-viewer/viewer";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { getLocale } from "@/lib/locale";
import { Alert } from "@/lib/ui/components/alert";
import { redactLhr } from "@/server/domain/lhr-redact";
import { localizeLhr } from "@/server/report/lighthouse-report";
import { loadAuditLhr } from "@/server/services/audit-lhr";
import { getPortalAudit } from "@/server/services/portal";
import { BlockedNotice } from "../../../../_components/blocked-notice";
import { PortalShell } from "../../../../_components/portal-shell";
import { SuspendedNotice } from "../../../../_components/suspended-notice";
import { portalAccess } from "../../../../_lib/access";
import { portalProjectPath } from "@/lib/urls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Detalle técnico · AOC PageSpeed", robots: { index: false, follow: false } };

export default async function PortalAuditDetail({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; projectId: string; auditId: string }>;
  searchParams: Promise<ViewerSearch>;
}) {
  const { token, projectId, auditId } = await params;
  const search = await searchParams;
  const access = await portalAccess(token);
  if (access.state === "blocked") return <BlockedNotice />;
  if (access.state === "suspended") return <SuspendedNotice clientName={access.clientName} />;
  const found = await getPortalAudit(access.client.id, projectId, auditId);
  if (!found) notFound();
  const { audit, redact } = found;
  const locale = await getLocale();
  const base = portalProjectPath(token, found.projectSlug);
  const stored = await loadAuditLhr(audit);
  const lhr = stored ? localizeLhr(redact ? redactLhr(stored) : stored, locale) : null;

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
      {lhr ? (
        <AuditViewer
          lhr={lhr}
          locale={locale}
          basePath={`${base}/detalle/${audit.id}`}
          search={search}
          evidenceImageSrc={redact ? null : `${base}/detalle/${audit.id}/captura`}
          reportSrc={`${base}/detalle/${audit.id}/informe`}
        />
      ) : (
        <Alert tone="danger">No se pudo leer el informe de esta auditoría. Inténtalo de nuevo en unos minutos.</Alert>
      )}
    </PortalShell>
  );
}
