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
import { getPortalAudit, getPortalSiblings } from "@/server/services/portal";
import { ProfileSwitch } from "@/lib/ui/components/profile-switch";
import { PortalPage } from "../../../../_components/portal-page";
import { loadProjectGate } from "../../../../_lib/project-gate";
import { pageTitle } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Detalle de ingeniería"), robots: { index: false, follow: false } };

export default async function PortalAuditDetail({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; projectId: string; auditId: string }>;
  searchParams: Promise<ViewerSearch>;
}) {
  const { token, projectId, auditId } = await params;
  const search = await searchParams;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const found = await getPortalAudit(gate.client.id, projectId, auditId);
  if (!found) notFound();
  const { audit, redact } = found;
  const siblings = await getPortalSiblings(gate.client.id, projectId, auditId);
  const locale = await getLocale();
  const base = gate.base;
  const qs = search.vista ? `?vista=${encodeURIComponent(search.vista)}` : "";
  const stored = await loadAuditLhr(audit);
  const lhr = stored ? localizeLhr(redact ? redactLhr(stored) : stored, locale) : null;

  return (
    <PortalPage
      title="Detalle de ingeniería"
      subtitle={
        <>
          <span className="font-mono text-[15px] break-all">{audit.routePath}</span> · {PROFILE_LABEL[audit.profile]} · {formatDate(audit.finishedAt)}
          {" · "}
          <Link href={`${base}/rutas`} className="font-semibold text-link hover:underline">
            Volver a las rutas
          </Link>
        </>
      }
    >
      {siblings ? (
        <ProfileSwitch
          current={audit.profile}
          currentScore={audit.scorePerformance}
          siblings={siblings}
          currentHref={`${base}/detalle/${audit.id}${qs}`}
          hrefFor={(sid) => `${base}/detalle/${sid}${qs}`}
        />
      ) : null}
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
    </PortalPage>
  );
}
