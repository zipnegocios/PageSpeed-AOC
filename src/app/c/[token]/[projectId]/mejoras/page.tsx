import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { getPortalImprovements } from "@/server/services/portal";
import { ImprovementList } from "../../../_components/improvement-list";
import { PortalPage } from "../../../_components/portal-page";
import { loadProjectGate } from "../../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Mejoras"), robots: { index: false, follow: false } };

export default async function PortalImprovements({ params }: { params: Promise<{ token: string; projectId: string }> }) {
  const { token, projectId } = await params;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, base } = gate;
  if (projectId !== project.slug) redirect(`${base}/mejoras`);
  const data = await getPortalImprovements(project);
  return (
    <PortalPage
      title="Mejoras"
      subtitle={
        data.total === 0
          ? "Todo está dentro de la meta acordada."
          : `${data.total} ${data.total === 1 ? "punto" : "puntos"} por mejorar en ${data.pages.length} ${data.pages.length === 1 ? "página" : "páginas"}. Esto es lo que hace que cada nota esté por debajo de la meta.`
      }
    >
      {data.total === 0 ? (
        <p className="rounded-lg bg-surface-200 p-4 text-ink">No hay nada pendiente por ahora. Te avisaremos si algo baja de la meta.</p>
      ) : (
        <ImprovementList data={data} base={base} />
      )}
    </PortalPage>
  );
}
