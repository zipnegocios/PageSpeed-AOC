import { PinGateFor } from "@/app/c/_components/pin-gate";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/audit-format";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { ScoreRing } from "@/lib/ui/components/score-ring";
import { getPortalOverview } from "@/server/services/portal";
import { PhaseBadge } from "../_components/phase-badge";
import { BlockedNotice } from "../_components/blocked-notice";
import { PortalShell } from "../_components/portal-shell";
import { SuspendedNotice } from "../_components/suspended-notice";
import { portalAccess } from "../_lib/access";
import { portalProjectPath } from "@/lib/urls";
import { pageTitle } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Tu informe"), robots: { index: false, follow: false } };

const SCORE_LABELS = [
  ["performance", "Rendimiento"],
  ["seo", "SEO"],
  ["accessibility", "Accesibilidad"],
  ["best_practices", "Buenas prácticas"],
] as const;

export default async function PortalHome({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await portalAccess(token);
  if (access.state === "blocked") return <BlockedNotice />;
  if (access.state === "suspended") return <SuspendedNotice clientName={access.clientName} contact={access.contact} />;
  // Enlace antiguo con token: ya no da acceso, lleva al portal con PIN.
  if (access.state === "legacy") redirect(`/c/${access.slug}`);
  if (access.state === "pin") return <PinGateFor slug={token} />;

  const projects = await getPortalOverview(access.client.id);
  // Con un único proyecto no hay nada que elegir: se va directo a su informe.
  if (projects.length === 1) redirect(portalProjectPath(token, projects[0]!.slug));

  return (
    <PortalShell clientName={access.client.name} title="Tu informe" subtitle="Así van tus sitios en las últimas auditorías.">
      {projects.length === 0 ? (
        <Card>
          <p className="text-ink-muted">Aún no hay proyectos. Cuando tu sitio empiece a medirse, aparecerá aquí, en desarrollo o en producción.</p>
        </Card>
      ) : (
        projects.map((p) => (
          <Card key={p.id} title={p.name} description={p.baseUrl} actions={<PhaseBadge phase={p.phase} />}>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {SCORE_LABELS.map(([key, label]) => (
                <div key={key} className="flex flex-col items-center gap-2 text-center">
                  <dd className="order-1">
                    <ScoreRing value={p.averages[key]} label={label} size={72} />
                  </dd>
                  <dt className="order-2 text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</dt>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              {p.openAlerts > 0 ? (
                <Badge tone="danger">
                  {p.openAlerts} {p.openAlerts === 1 ? "punto por mejorar" : "puntos por mejorar"}
                </Badge>
              ) : (
                <Badge tone="ok">Todo dentro de la meta</Badge>
              )}
              <span className="text-[15px] text-ink-muted">Última auditoría: {formatDate(p.lastAuditAt)}</span>
            </div>
            <div>
              <Link href={portalProjectPath(token, p.slug)} className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300">
                Ver el detalle
              </Link>
            </div>
          </Card>
        ))
      )}
    </PortalShell>
  );
}
