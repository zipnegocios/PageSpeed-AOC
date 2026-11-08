import { PinGateFor } from "@/app/c/_components/pin-gate";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FieldDataCard } from "@/app/_components/field-data-card";
import { HistoryPanel, type HistorySearch } from "@/app/_components/history-panel";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { Badge } from "@/lib/ui/components/badge";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { Card } from "@/lib/ui/components/card";
import { Delta } from "@/lib/ui/components/delta";
import { PortalPageCard, groupLatestByPage } from "@/app/c/_components/portal-page-card";
import { getPortalOverview, getPortalProject } from "@/server/services/portal";
import { BlockedNotice } from "../../_components/blocked-notice";
import { PortalShell } from "../../_components/portal-shell";
import { SuspendedNotice } from "../../_components/suspended-notice";
import { portalAccess } from "../../_lib/access";
import { portalProjectPath } from "@/lib/urls";
import { pageTitle } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Tu informe"), robots: { index: false, follow: false } };

const SCORES = [
  ["performance", "Rendimiento"],
  ["seo", "SEO"],
  ["accessibility", "Accesibilidad"],
  ["best_practices", "Buenas prácticas"],
] as const;

export default async function PortalProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; projectId: string }>;
  searchParams: Promise<HistorySearch>;
}) {
  const { token, projectId } = await params;
  const search = await searchParams;
  const access = await portalAccess(token);
  if (access.state === "blocked") return <BlockedNotice />;
  if (access.state === "suspended") return <SuspendedNotice clientName={access.clientName} />;
  if (access.state === "legacy") notFound();
  if (access.state === "pin") return <PinGateFor slug={token} />;

  const project = await getPortalProject(access.client.id, projectId);
  if (!project) notFound();
  // Un enlace antiguo con UUID se lleva a la dirección legible.
  if (projectId !== project.slug) redirect(portalProjectPath(token, project.slug));
  const several = (await getPortalOverview(access.client.id)).length > 1;

  return (
    <PortalShell
      clientName={access.client.name}
      title={project.name}
      subtitle={
        <>
          <span className="font-mono break-all text-[15px]">{project.baseUrl}</span>
          {several ? (
            <>
              {" · "}
              <Link href={`/c/${token}`} className="font-semibold text-link hover:underline">
                Todos tus proyectos
              </Link>
            </>
          ) : null}
        </>
      }
    >
      <Card
        title="Estado actual"
        description="Resultado de la última auditoría de cada página, en móvil y en escritorio, frente a la anterior."
        actions={
          <a
            href={`${portalProjectPath(token, project.slug)}/informe`}
            download
            className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300"
          >
            Descargar informe (PDF)
          </a>
        }
      >
        {project.latest.length === 0 ? (
          <p className="text-ink-muted">Todavía no hay auditorías de este proyecto.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groupLatestByPage(project.latest).map((pg) => (
              <PortalPageCard key={pg.routeId} page={pg} detailBase={portalProjectPath(token, project.slug)} />
            ))}
          </div>
        )}
      </Card>

      {project.improvements.length > 0 ? (
        <Card title="Puntos por mejorar" description="Lo que está por debajo de la meta acordada para tu sitio.">
          <ul className="divide-y divide-border rounded-sm border border-border">
            {project.improvements.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="danger">{a.kind === "audit_failure" ? "Sin datos" : "Bajo la meta"}</Badge>
                  <span className="font-semibold text-ink">
                    {a.kind === "audit_failure" ? "No pudimos auditar esta página" : a.summary}
                  </span>
                </div>
                <p className="text-[15px] text-ink-muted">
                  <span className="font-mono break-all">{a.routePath}</span> · {PROFILE_LABEL[a.profile]} · desde {formatDate(a.openedAt)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <HistoryPanel
        projectId={project.id}
        basePath={portalProjectPath(token, project.slug)}
        search={search}
        description="Cómo han cambiado las puntuaciones de tus páginas con el tiempo."
      />

      <FieldDataCard projectId={project.id} basePath={portalProjectPath(token, project.slug)} search={search} audience="client" />
    </PortalShell>
  );
}
