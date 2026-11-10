import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { PortalPageCard, groupLatestByPage } from "../../../_components/portal-page-card";
import { PortalPage } from "../../../_components/portal-page";
import { loadProjectGate } from "../../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Rutas"), robots: { index: false, follow: false } };

export default async function PortalRoutes({ params }: { params: Promise<{ token: string; projectId: string }> }) {
  const { token, projectId } = await params;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, base } = gate;
  if (projectId !== project.slug) redirect(`${base}/rutas`);
  return (
    <PortalPage title="Rutas" subtitle="Resultado de la última auditoría de cada página, en móvil y en escritorio, frente a la anterior.">
      {project.latest.length === 0 ? (
        <p className="rounded-lg bg-surface-200 p-4 text-ink-muted">Todavía no hay auditorías de este proyecto.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {groupLatestByPage(project.latest).map((pg) => (
            <PortalPageCard key={pg.routeId} page={pg} detailBase={base} />
          ))}
        </div>
      )}
    </PortalPage>
  );
}
