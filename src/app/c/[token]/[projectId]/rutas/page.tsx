import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { getPortalRouteTree } from "@/server/services/portal";
import { PortalPage } from "../../../_components/portal-page";
import { PortalRouteTree, RouteLegend } from "../../../_components/route-tree";
import { loadProjectGate } from "../../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Rutas"), robots: { index: false, follow: false } };

export default async function PortalRoutes({ params }: { params: Promise<{ token: string; projectId: string }> }) {
  const { token, projectId } = await params;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, base } = gate;
  if (projectId !== project.slug) redirect(`${base}/rutas`);
  const tree = await getPortalRouteTree(project);
  return (
    <PortalPage
      title="Rutas"
      subtitle={
        tree.pages === 0
          ? "Todavía no hay auditorías de este proyecto."
          : `${tree.pages} ${tree.pages === 1 ? "página" : "páginas"} · toca una para ver sus métricas y las páginas que contiene.`
      }
    >
      {tree.pages === 0 ? null : (
        <>
          <RouteLegend />
          <PortalRouteTree nodes={tree.nodes} base={base} />
        </>
      )}
    </PortalPage>
  );
}
